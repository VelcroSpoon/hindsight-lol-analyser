import type { Rule, RuleContext } from "../engine";
import type { Finding } from "../finding";
import type { ChampionKillEvent, Position, WardPlacedEvent } from "../../riot/types";
import {
  buildParticipantAnchors,
  estimateFromAnchors,
  positionUncertainty,
  worstCaseDisplacement,
  type Anchor,
} from "../../timeline/positionAnchors";
import { allEvents, formatGameTime, formatNumber, sameTeam, distance } from "../util";
import { championNames, describeParticipant } from "../../timeline/champions";

/**
 * Rule: "deaths without vision".
 *
 * For each of the target player's deaths, check whether any FRIENDLY ward was
 * live near the death location. If not, the player died in the dark.
 *
 * DATA REALITY (confirmed against real timelines): WARD_PLACED / WARD_KILL
 * events carry no coordinates and no ward identity. Ward position is therefore
 * ESTIMATED from the creator's position at placement time, using frame
 * snapshots plus event anchors (see timeline/positionAnchors.ts).
 *
 * ACCURACY GATE — the important part. Measured against 2801 held-out deaths,
 * the position estimator's median error is ~864 units, but p90 is ~3536. That
 * error is comparable to the vision threshold itself, so a naive verdict is
 * often noise. Each estimated ward therefore carries an expected error (the
 * measured p75 error for its gap to the nearest anchor), and the rule only
 * judges a death when enough of the live wards are placed confidently. It
 * abstains otherwise. This trades recall for precision on purpose — a false
 * accusation costs the player's trust; a missed one costs nothing.
 *
 * Because ward kills can't be matched to a specific ward (no identity, no
 * position), wards are assumed live from placement until WARD_LIFETIME_MS.
 *
 * ---- TUNABLE CONSTANTS ----
 */

/**
 * How close (game units) a live friendly ward must be to a death for the death
 * to count as "had vision". Ward sight radius is ~900; extra slack absorbs
 * position-estimate error. Larger = more forgiving (fewer findings).
 */
export const VISION_DISTANCE_UNITS = 1400;

/**
 * How long a placed ward is assumed to stay live, in ms. Real durations vary by
 * type (~90–240s), but `wardType` is mostly "UNDEFINED" so we use one default.
 */
export const WARD_LIFETIME_MS = 150_000;

/**
 * Maximum expected error (game units) on an ESTIMATED ward position before we
 * refuse to trust that ward. Compared against `positionUncertainty`, the
 * measured p75 error for the ward's gap to its nearest anchor. Lower =
 * stricter/quieter, higher = noisier.
 */
export const MAX_WARD_POSITION_UNCERTAINTY = 2500;

/**
 * If we had to discard this fraction (or more) of the player's live wards as
 * too-uncertain, we can't honestly claim "no ward was nearby" — so we skip the
 * death entirely rather than emit a finding we can't stand behind.
 */
export const MAX_DISCARDED_WARD_FRACTION = 0.5;

/** Severity assigned to a death-without-vision finding (1 info, 2 warn, 3 crit). */
const SEVERITY: Finding["severity"] = 2;

/**
 * How the rule places and trusts wards. The default is what ships. The other
 * settings reproduce earlier versions of this rule, so scripts/eval-rule.ts can
 * compare all three on the same games using this exact code:
 *
 *   naive       frames only, every ward trusted      — the first version
 *   worst-case  event anchors, movement-speed bound  — the first gated version
 *   calibrated  event anchors, measured-error curve  — current (default)
 */
export interface VisionOptions {
  useEventAnchors: boolean;
  uncertainty: "calibrated" | "worst-case" | "none";
}

export const VISION_VERSIONS = {
  naive: { useEventAnchors: false, uncertainty: "none" },
  "worst-case": { useEventAnchors: true, uncertainty: "worst-case" },
  calibrated: { useEventAnchors: true, uncertainty: "calibrated" },
} satisfies Record<string, VisionOptions>;

export const DEFAULT_VISION_OPTIONS: VisionOptions = VISION_VERSIONS.calibrated;

type LocatedKill = ChampionKillEvent & { position: Position };

/** A friendly ward that was live at the moment of a death, as the rule saw it. */
export interface WardEvidence {
  /** Estimated position (the placer's estimated position when it was placed). */
  pos: Position;
  /** Expected error on that estimate, in game units (p75, see positionUncertainty). */
  uncertainty: number;
  /** Whether the rule trusted this ward's position enough to use it. */
  confident: boolean;
  placedAt: number;
}

/** What the rule decided about one death, and the evidence behind it. */
export type DeathDecision =
  | { verdict: "flagged"; kill: LocatedKill; wards: WardEvidence[]; nearest: number; confidentWards: number }
  | { verdict: "covered"; kill: LocatedKill; wards: WardEvidence[]; nearest: number }
  | { verdict: "abstained"; kill: LocatedKill; wards: WardEvidence[] };

type Flagged = Extract<DeathDecision, { verdict: "flagged" }>;

interface EstimatedWard {
  placedAt: number;
  expiresAt: number;
  pos: Position;
  uncertainty: number;
}

/**
 * Decide flagged / covered / abstained for each of the player's deaths that
 * has coordinates. Pure. `evaluate` turns the flagged ones into findings.
 */
export function classifyDeaths(
  ctx: RuleContext,
  opts: VisionOptions = DEFAULT_VISION_OPTIONS,
): DeathDecision[] {
  const { participantId } = ctx;
  const events = allEvents(ctx.timeline);

  // Anchor sets are expensive to rebuild per ward; cache one per creator.
  const anchorCache = new Map<number, Anchor[]>();
  const anchorsFor = (pid: number): Anchor[] => {
    let a = anchorCache.get(pid);
    if (!a) {
      a = buildParticipantAnchors(ctx.timeline, pid, { useEventAnchors: opts.useEventAnchors });
      anchorCache.set(pid, a);
    }
    return a;
  };
  const uncertaintyOf = (anchors: Anchor[], t: number): number =>
    opts.uncertainty === "none"
      ? 0
      : opts.uncertainty === "worst-case"
        ? worstCaseDisplacement(anchors, t)
        : positionUncertainty(anchors, t);

  // Estimate friendly ward positions, recording how trustworthy each one is.
  const wards: EstimatedWard[] = [];
  for (const ev of events) {
    if (ev.type !== "WARD_PLACED") continue;
    const w = ev as WardPlacedEvent;
    if (!sameTeam(w.creatorId, participantId)) continue; // enemy wards give us nothing
    const anchors = anchorsFor(w.creatorId);
    const pos = estimateFromAnchors(anchors, w.timestamp);
    if (!pos) continue;
    wards.push({
      placedAt: w.timestamp,
      expiresAt: w.timestamp + WARD_LIFETIME_MS,
      pos,
      uncertainty: uncertaintyOf(anchors, w.timestamp),
    });
  }

  const decisions: DeathDecision[] = [];

  for (const ev of events) {
    if (ev.type !== "CHAMPION_KILL") continue;
    const k = ev as ChampionKillEvent;
    if (k.victimId !== participantId) continue; // only OUR deaths
    if (!k.position) continue; // death coords are exact when present
    const kill = k as LocatedKill;

    const liveWards = wards.filter(
      (w) => w.placedAt <= kill.timestamp && kill.timestamp <= w.expiresAt,
    );

    // Split live wards into ones we can trust to place on the map and ones we can't.
    const isConfident = (w: EstimatedWard) => w.uncertainty <= MAX_WARD_POSITION_UNCERTAINTY;
    const confident = liveWards.filter(isConfident);
    const discarded = liveWards.length - confident.length;
    const evidence: WardEvidence[] = liveWards.map((w) => ({
      pos: w.pos,
      uncertainty: w.uncertainty,
      confident: isConfident(w),
      placedAt: w.placedAt,
    }));

    // If we threw away too much of the vision picture, we cannot honestly say
    // the player had no vision. Stay silent instead of guessing.
    if (liveWards.length > 0 && discarded / liveWards.length >= MAX_DISCARDED_WARD_FRACTION) {
      decisions.push({ verdict: "abstained", kill, wards: evidence });
      continue;
    }

    let nearest = Infinity;
    for (const w of confident) {
      const d = distance(w.pos, kill.position);
      if (d < nearest) nearest = d;
    }

    decisions.push(
      nearest <= VISION_DISTANCE_UNITS
        ? { verdict: "covered", kill, wards: evidence, nearest }
        : { verdict: "flagged", kill, wards: evidence, nearest, confidentWards: confident.length },
    );
  }

  return decisions;
}

function toFinding({ kill, nearest, confidentWards }: Flagged, names: Map<number, string>): Finding {
  const when = formatGameTime(kill.timestamp);
  const killer = describeParticipant(names, kill.killerId ?? 0);
  // Location isn't spelled out: it's in `position`, and the map shows it.
  const detail =
    confidentWards === 0
      ? `Died at ${when} with no friendly wards up anywhere on the map. Killed by ${killer}.`
      : `Died at ${when}. The nearest friendly ward was about ${formatNumber(nearest)} units ` +
        `away; the rule counts ${formatNumber(VISION_DISTANCE_UNITS)} as close. Judged from ` +
        `${confidentWards} confidently placed ward${confidentWards === 1 ? "" : "s"}. Killed by ${killer}.`;

  return {
    ruleId: deathsWithoutVisionRule.id,
    severity: SEVERITY,
    gameTimeMs: kill.timestamp,
    title: "Death without vision",
    detail,
    position: { x: kill.position.x, y: kill.position.y },
  };
}

function evaluate(ctx: RuleContext): Finding[] {
  const names = championNames(ctx.timeline);
  return classifyDeaths(ctx)
    .filter((d): d is Flagged => d.verdict === "flagged")
    .map((d) => toFinding(d, names));
}

export const deathsWithoutVisionRule: Rule = {
  id: "deaths-without-vision",
  description:
    "Flags the player's deaths where no friendly ward was confidently live within a distance threshold of the death location.",
  evaluate,
};
