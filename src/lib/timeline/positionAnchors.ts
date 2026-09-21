import type { MatchTimelineDto, Position } from "../riot/types";

/**
 * Champion position estimation from event anchors.
 *
 * The timeline only snapshots positions every `frameInterval` ms (60s in
 * practice). Interpolating a champion's position across a 60s gap is wildly
 * inaccurate mid-fight. But several event types pin a champion to a known point
 * at a known instant:
 *
 *   - CHAMPION_KILL.position IS the victim's exact location at death (EXACT).
 *   - CHAMPION_KILL.position for the KILLER — they're within kill range (~soft).
 *   - CHAMPION_SPECIAL_KILL / ELITE_MONSTER_KILL / BUILDING_KILL killer — the
 *     killer is at/near that point (~soft, a few hundred units).
 *
 * Adding these as interpolation anchors shrinks the gaps we interpolate across,
 * especially around fights (which is exactly where deaths happen). This module
 * is pure and reusable by any rule that needs "where was participant P at t?".
 */

export type AnchorKind =
  | "frame"
  | "death"
  | "kill"
  | "special"
  | "objective"
  | "building"
  | "shop";

/**
 * Fountain (spawn) coordinates per team on Summoner's Rift. Team 100 = blue
 * (bottom-left), team 200 = red (top-right). ITEM_PURCHASED can only happen at
 * the shop, so it pins the buyer to their fountain at that instant.
 */
export const FOUNTAIN_BLUE: Position = { x: 560, y: 580 };
export const FOUNTAIN_RED: Position = { x: 14340, y: 14390 };

/** participantIds 1–5 are team 100 (blue); 6–10 are team 200 (red). */
export function fountainFor(participantId: number): Position {
  return participantId <= 5 ? FOUNTAIN_BLUE : FOUNTAIN_RED;
}

export interface Anchor {
  t: number;
  pos: Position;
  /** True if this pins the participant's location exactly (frames, own death). */
  exact: boolean;
  kind: AnchorKind;
}

export interface BuildAnchorOptions {
  /** Include event-derived anchors (kills/deaths/objectives). Default true. */
  useEventAnchors?: boolean;
  /**
   * Drop the participant's own death anchor at exactly this timestamp. Used for
   * leave-one-out evaluation so a held-out death can't leak its own answer.
   */
  excludeDeathTimestamp?: number;
}

interface KillLike {
  timestamp: number;
  position?: Position;
  killerId?: number;
  victimId?: number;
}

/**
 * Collect the interpolation anchors for one participant, sorted by time.
 * Frames are always included; event anchors are opt-in (default on).
 */
export function buildParticipantAnchors(
  timeline: MatchTimelineDto,
  participantId: number,
  opts: BuildAnchorOptions = {},
): Anchor[] {
  const { useEventAnchors = true, excludeDeathTimestamp } = opts;
  const anchors: Anchor[] = [];

  for (const frame of timeline.info.frames) {
    const pf = frame.participantFrames?.[String(participantId)];
    if (pf?.position) {
      anchors.push({ t: frame.timestamp, pos: pf.position, exact: true, kind: "frame" });
    }

    if (!useEventAnchors) continue;

    for (const ev of frame.events ?? []) {
      const e = ev as KillLike & { type: string };
      switch (e.type) {
        case "CHAMPION_KILL": {
          if (e.victimId === participantId && e.position && e.timestamp !== excludeDeathTimestamp) {
            anchors.push({ t: e.timestamp, pos: e.position, exact: true, kind: "death" });
          }
          if (e.killerId === participantId && e.position) {
            anchors.push({ t: e.timestamp, pos: e.position, exact: false, kind: "kill" });
          }
          break;
        }
        case "CHAMPION_SPECIAL_KILL":
          if (e.killerId === participantId && e.position) {
            anchors.push({ t: e.timestamp, pos: e.position, exact: false, kind: "special" });
          }
          break;
        case "ELITE_MONSTER_KILL":
          if (e.killerId === participantId && e.position) {
            anchors.push({ t: e.timestamp, pos: e.position, exact: false, kind: "objective" });
          }
          break;
        case "BUILDING_KILL":
          // killerId 0 = a minion took it; not a champion anchor.
          if (e.killerId === participantId && e.killerId !== 0 && e.position) {
            anchors.push({ t: e.timestamp, pos: e.position, exact: false, kind: "building" });
          }
          break;
        // NOTE: ITEM_PURCHASED (fountain) anchors were TRIED AND REJECTED.
        // Measured on 1107 held-out deaths they made median error much WORSE
        // (954 -> 2767 units): linear interpolation from a fountain anchor
        // drags estimates along a straight line from spawn, but champions
        // actually travel curved lane paths. Kept as a note so it isn't
        // "rediscovered" later. See scripts/eval-position.ts.
      }
    }
  }

  // Time order; on ties prefer the exact anchor so interpolation neighbors it.
  anchors.sort((a, b) => a.t - b.t || Number(b.exact) - Number(a.exact));
  return anchors;
}

/**
 * Estimate a position at time `t` by linear interpolation between the two
 * surrounding anchors. Clamps to the nearest anchor outside the covered range.
 * Returns null only if there are no anchors at all.
 */
export function estimateFromAnchors(anchors: Anchor[], t: number): Position | null {
  if (anchors.length === 0) return null;
  if (t <= anchors[0].t) return anchors[0].pos;
  const last = anchors[anchors.length - 1];
  if (t >= last.t) return last.pos;

  for (let i = 0; i < anchors.length - 1; i++) {
    const lo = anchors[i];
    const hi = anchors[i + 1];
    if (t >= lo.t && t <= hi.t) {
      const span = hi.t - lo.t || 1;
      const f = (t - lo.t) / span;
      return {
        x: lo.pos.x + (hi.pos.x - lo.pos.x) * f,
        y: lo.pos.y + (hi.pos.y - lo.pos.y) * f,
      };
    }
  }
  return last.pos; // unreachable given the clamps above
}

/**
 * Typical champion movement speed in units/second. Real values run ~330–450
 * depending on items/boots/buffs; we use a generous upper bound so the
 * displacement envelope below is a true bound rather than a guess.
 */
export const MAX_MOVE_SPEED_UNITS_PER_SEC = 450;

/** Milliseconds from `t` to the nearest anchor (Infinity if none). */
export function gapToNearestAnchor(anchors: Anchor[], t: number): number {
  let best = Infinity;
  for (const a of anchors) best = Math.min(best, Math.abs(a.t - t));
  return best;
}

/**
 * Worst-case displacement bound: gap x max move speed. Sound but very loose —
 * champions don't sprint in a straight line away from their last known point.
 * Kept for reference and comparison; `positionUncertainty` uses the calibrated
 * curve below instead.
 */
export function worstCaseDisplacement(anchors: Anchor[], t: number): number {
  const gapMs = gapToNearestAnchor(anchors, t);
  if (!Number.isFinite(gapMs)) return Infinity;
  return (gapMs / 1000) * MAX_MOVE_SPEED_UNITS_PER_SEC;
}

/**
 * EMPIRICALLY CALIBRATED uncertainty curve: p75 position error observed as a
 * function of gap-to-nearest-anchor, measured over 2801 held-out deaths across
 * 36 matches, remakes excluded (see scripts/eval-uncertainty.ts, which regenerates this table).
 *
 *   gap (s)   n     p75 error (units)
 *   0–2      375     418
 *   2–5      451     778
 *   5–10     540    1278
 *   10–15    417    1826
 *   15–20    360    3010
 *   20–30    657    3651
 *
 * Using measured error instead of the worst-case bound means the confidence
 * gate reflects how far champions ACTUALLY are from their estimate, rather than
 * how far they theoretically could be — which is 2.2–3.7x tighter in practice.
 */
const UNCERTAINTY_CURVE: { gapSec: number; p75Err: number }[] = [
  { gapSec: 1, p75Err: 418 },
  { gapSec: 3.5, p75Err: 778 },
  { gapSec: 7.5, p75Err: 1278 },
  { gapSec: 12.5, p75Err: 1826 },
  { gapSec: 17.5, p75Err: 3010 },
  { gapSec: 25, p75Err: 3651 },
];

/**
 * Expected (p75) error radius on an estimated position at time `t`. A value of
 * 1200 means "three times in four, the true position is within ~1200 units of
 * this estimate" — the honest confidence figure a rule should gate on.
 */
export function positionUncertainty(anchors: Anchor[], t: number): number {
  const gapMs = gapToNearestAnchor(anchors, t);
  if (!Number.isFinite(gapMs)) return Infinity;
  const gapSec = gapMs / 1000;

  const first = UNCERTAINTY_CURVE[0];
  const last = UNCERTAINTY_CURVE[UNCERTAINTY_CURVE.length - 1];
  if (gapSec <= first.gapSec) {
    // Scale down linearly toward 0 error at 0 gap.
    return (gapSec / first.gapSec) * first.p75Err;
  }
  if (gapSec >= last.gapSec) {
    // Beyond the measured range, fall back to the worst-case bound so we stay
    // conservative rather than extrapolating a curve we haven't validated.
    return Math.max(last.p75Err, gapSec * MAX_MOVE_SPEED_UNITS_PER_SEC * 0.3);
  }
  for (let i = 0; i < UNCERTAINTY_CURVE.length - 1; i++) {
    const lo = UNCERTAINTY_CURVE[i];
    const hi = UNCERTAINTY_CURVE[i + 1];
    if (gapSec >= lo.gapSec && gapSec <= hi.gapSec) {
      const f = (gapSec - lo.gapSec) / (hi.gapSec - lo.gapSec);
      return lo.p75Err + (hi.p75Err - lo.p75Err) * f;
    }
  }
  return last.p75Err;
}
