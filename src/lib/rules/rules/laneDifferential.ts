import type { Rule, RuleContext } from "../engine";
import type { Finding } from "../finding";
import { formatNumber, frameAtOrBefore } from "../util";
import { championNames, describeParticipant } from "../../timeline/champions";

/**
 * Rule: "lane differential at 10 and 15 minutes".
 *
 * Compares the player's gold and XP against their direct lane opponent at two
 * checkpoints. Unlike the vision rule, this needs NO position estimation —
 * gold and XP come straight from participantFrames, which are exact. So this
 * rule is accurate out of the gate.
 *
 * LANE OPPONENT HEURISTIC: Riot orders participants by role within each team
 * (1–5 = team 100 top/jg/mid/bot/sup, 6–10 = team 200 in the same order), so
 * participant N faces participant N+5. This holds for the overwhelming majority
 * of ranked games but is a convention, not a guarantee — a hard role swap can
 * mis-pair. Documented rather than silently assumed.
 *
 * ---- TUNABLE CONSTANTS ----
 */

/** Checkpoints (ms) at which to compare. 10 and 15 minutes are the standard ones. */
export const CHECKPOINTS_MS = [600_000, 900_000];

/** Gold deficit (or worse) that earns a finding. */
export const GOLD_DEFICIT_THRESHOLD = 800;

/** XP deficit (or worse) that earns a finding. */
export const XP_DEFICIT_THRESHOLD = 1000;

/** A deficit at least this large is treated as critical rather than a warning. */
export const SEVERE_GOLD_DEFICIT = 2000;

/** participant N faces participant N+5 (see heuristic note above). */
export function laneOpponentOf(participantId: number): number {
  return participantId <= 5 ? participantId + 5 : participantId - 5;
}

function evaluate(ctx: RuleContext): Finding[] {
  const { timeline, participantId } = ctx;
  const opponentId = laneOpponentOf(participantId);
  const opponent = describeParticipant(championNames(timeline), opponentId);
  const findings: Finding[] = [];

  for (const checkpoint of CHECKPOINTS_MS) {
    const frame = frameAtOrBefore(timeline, checkpoint);
    // Game ended before this checkpoint — nothing to compare.
    if (!frame || frame.timestamp < checkpoint - 60_000) continue;

    const me = frame.participantFrames?.[String(participantId)];
    const them = frame.participantFrames?.[String(opponentId)];
    if (!me || !them) continue;

    const minute = Math.round(checkpoint / 60_000);
    const goldDiff = (me.totalGold ?? 0) - (them.totalGold ?? 0);
    const xpDiff = (me.xp ?? 0) - (them.xp ?? 0);

    if (goldDiff <= -GOLD_DEFICIT_THRESHOLD) {
      findings.push({
        ruleId: laneDifferentialRule.id,
        severity: goldDiff <= -SEVERE_GOLD_DEFICIT ? 3 : 2,
        gameTimeMs: checkpoint,
        title: `Down ${formatNumber(Math.abs(goldDiff))} gold at ${minute} min`,
        detail:
          `At ${minute} minutes you had ${formatNumber(me.totalGold ?? 0)} gold to your lane ` +
          `opponent's ${formatNumber(them.totalGold ?? 0)}. ` +
          `(Lane opponent taken to be ${opponent}, from role order.)`,
      });
    }

    if (xpDiff <= -XP_DEFICIT_THRESHOLD) {
      findings.push({
        ruleId: laneDifferentialRule.id,
        severity: 2,
        gameTimeMs: checkpoint,
        title: `Down ${formatNumber(Math.abs(xpDiff))} XP at ${minute} min`,
        detail:
          `At ${minute} minutes you were level ${me.level ?? "?"} with ${formatNumber(me.xp ?? 0)} XP; ` +
          `your lane opponent was level ${them.level ?? "?"} with ${formatNumber(them.xp ?? 0)}. ` +
          `(Lane opponent taken to be ${opponent}, from role order.)`,
      });
    }
  }

  return findings;
}

export const laneDifferentialRule: Rule = {
  id: "lane-differential",
  description:
    "Flags significant gold or XP deficits against the direct lane opponent at 10 and 15 minutes.",
  evaluate,
};
