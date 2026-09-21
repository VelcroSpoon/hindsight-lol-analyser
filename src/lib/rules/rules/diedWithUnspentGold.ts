import type { Rule, RuleContext } from "../engine";
import type { Finding } from "../finding";
import type { ChampionKillEvent } from "../../riot/types";
import { allEvents, formatGameTime, formatNumber, frameAtOrBefore } from "../util";

/**
 * Rule: "died with unspent gold".
 *
 * Gold banked on a corpse is gold that did nothing. This flags deaths where the
 * player was carrying enough unspent gold to have bought a meaningful item.
 *
 * Like the lane-differential rule, this needs NO position estimation — the
 * death timestamp is exact and `currentGold` comes straight from
 * participantFrames. Accurate out of the gate.
 *
 * KNOWN APPROXIMATION: frames are 60s apart, so we read the gold snapshot from
 * the frame at or before the death; the player may have earned a little more
 * between that snapshot and dying. This can only UNDER-state gold carried
 * (gold accrues over time), so the rule never over-reports — it may just miss
 * borderline cases. That's the safe direction.
 *
 * ---- TUNABLE CONSTANTS ----
 */

/** Unspent gold at death at/above this earns a finding. ~1 completed component. */
export const UNSPENT_GOLD_THRESHOLD = 1200;

/** Unspent gold at/above this is treated as critical (a full item's worth). */
export const SEVERE_UNSPENT_GOLD = 2500;

/**
 * Ignore deaths before this time. Early-game gold thresholds are noisy and
 * pre-first-back gold is expected to be unspent.
 */
export const IGNORE_BEFORE_MS = 240_000; // 4 minutes

function evaluate(ctx: RuleContext): Finding[] {
  const { timeline, participantId } = ctx;
  const findings: Finding[] = [];

  for (const ev of allEvents(timeline)) {
    if (ev.type !== "CHAMPION_KILL") continue;
    const kill = ev as ChampionKillEvent;
    if (kill.victimId !== participantId) continue;
    if (kill.timestamp < IGNORE_BEFORE_MS) continue;

    const frame = frameAtOrBefore(timeline, kill.timestamp);
    const me = frame?.participantFrames?.[String(participantId)];
    if (!me || me.currentGold === undefined) continue;

    const gold = me.currentGold;
    if (gold < UNSPENT_GOLD_THRESHOLD) continue;

    findings.push({
      ruleId: diedWithUnspentGoldRule.id,
      severity: gold >= SEVERE_UNSPENT_GOLD ? 3 : 2,
      gameTimeMs: kill.timestamp,
      title: `Died holding ${formatNumber(gold)} unspent gold`,
      detail:
        `You died at ${formatGameTime(kill.timestamp)} carrying ${formatNumber(gold)} gold you ` +
        `hadn't spent. Backing to buy before this fight would have turned it into items. ` +
        `(Gold read from the ${formatGameTime(frame!.timestamp)} snapshot.)`,
      position: kill.position ? { x: kill.position.x, y: kill.position.y } : undefined,
    });
  }

  return findings;
}

export const diedWithUnspentGoldRule: Rule = {
  id: "died-with-unspent-gold",
  description:
    "Flags deaths where the player was carrying a significant amount of unspent gold.",
  evaluate,
};
