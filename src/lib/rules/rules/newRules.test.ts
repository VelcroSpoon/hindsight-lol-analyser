import { describe, it, expect } from "vitest";
import { runRules } from "../engine";
import { laneDifferentialRule, laneOpponentOf } from "./laneDifferential";
import { diedWithUnspentGoldRule, UNSPENT_GOLD_THRESHOLD } from "./diedWithUnspentGold";
import { rules as registeredRules } from "../registry";
import { buildTimeline, championKill, puuidFor } from "../../testing/fixtures";
import type { MatchTimelineDto } from "../../riot/types";

/**
 * Tests for the two position-free rules, plus a registry-level check that the
 * "one file + one line" claim actually holds.
 */

const TARGET = 2;

/** Build a timeline with explicit gold/xp for a pair of participants at a frame. */
function withStats(
  statsByFrame: Record<number, Record<number, { totalGold?: number; xp?: number; currentGold?: number; level?: number }>>,
  events: MatchTimelineDto["info"]["frames"][number]["events"] = [],
): MatchTimelineDto {
  const timeline = buildTimeline({ frameCount: 20, events });
  for (const frame of timeline.info.frames) {
    const stats = statsByFrame[frame.timestamp];
    if (!stats) continue;
    for (const [pid, values] of Object.entries(stats)) {
      frame.participantFrames[pid] = { participantId: Number(pid), ...values };
    }
  }
  return timeline;
}

describe("laneOpponentOf", () => {
  it("pairs each participant with the mirrored role on the other team", () => {
    expect([1, 2, 3, 4, 5].map(laneOpponentOf)).toEqual([6, 7, 8, 9, 10]);
    expect([6, 7, 8, 9, 10].map(laneOpponentOf)).toEqual([1, 2, 3, 4, 5]);
  });

  it("is symmetric", () => {
    for (let i = 1; i <= 10; i++) expect(laneOpponentOf(laneOpponentOf(i))).toBe(i);
  });
});

describe("laneDifferential", () => {
  const RULES = [laneDifferentialRule];

  it("flags a large gold deficit at 10 minutes", () => {
    const timeline = withStats({
      600_000: { 2: { totalGold: 3000, xp: 5000 }, 7: { totalGold: 5000, xp: 5000 } },
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    expect(findings).toHaveLength(1);
    expect(findings[0].title).toMatch(/Down 2,000 gold at 10 min/);
    expect(findings[0].severity).toBe(3); // >= SEVERE_GOLD_DEFICIT
  });

  it("does not flag when the player is ahead", () => {
    const timeline = withStats({
      600_000: { 2: { totalGold: 6000, xp: 6000 }, 7: { totalGold: 4000, xp: 5000 } },
    });
    expect(runRules(RULES, timeline, puuidFor(TARGET))).toHaveLength(0);
  });

  it("does not flag a deficit below the threshold", () => {
    const timeline = withStats({
      600_000: { 2: { totalGold: 4700, xp: 5000 }, 7: { totalGold: 5000, xp: 5000 } },
    });
    expect(runRules(RULES, timeline, puuidFor(TARGET))).toHaveLength(0);
  });

  it("flags an XP deficit independently of gold", () => {
    const timeline = withStats({
      600_000: { 2: { totalGold: 5000, xp: 3000, level: 8 }, 7: { totalGold: 5000, xp: 5000, level: 11 } },
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    expect(findings).toHaveLength(1);
    expect(findings[0].title).toMatch(/Down 2,000 XP/);
  });

  it("checks both the 10 and 15 minute checkpoints", () => {
    const timeline = withStats({
      600_000: { 2: { totalGold: 3000, xp: 5000 }, 7: { totalGold: 5000, xp: 5000 } },
      900_000: { 2: { totalGold: 5000, xp: 8000 }, 7: { totalGold: 8000, xp: 8000 } },
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    expect(findings.map((f) => f.gameTimeMs)).toEqual([600_000, 900_000]);
  });

  it("skips checkpoints the game never reached", () => {
    // Only 5 frames => game ended around 4 minutes.
    const timeline = buildTimeline({ frameCount: 5 });
    expect(runRules(RULES, timeline, puuidFor(TARGET))).toHaveLength(0);
  });
});

describe("diedWithUnspentGold", () => {
  const RULES = [diedWithUnspentGoldRule];

  it("flags a death while carrying gold over the threshold", () => {
    const timeline = withStats(
      { 300_000: { 2: { currentGold: 3000 } } },
      [championKill({ timestamp: 310_000, victimId: TARGET, position: { x: 1, y: 2 } })],
    );

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    expect(findings).toHaveLength(1);
    expect(findings[0].title).toMatch(/Died holding 3,000 unspent gold/);
    expect(findings[0].severity).toBe(3);
    expect(findings[0].position).toEqual({ x: 1, y: 2 });
  });

  it("does not flag a death with little gold banked", () => {
    const timeline = withStats(
      { 300_000: { 2: { currentGold: 200 } } },
      [championKill({ timestamp: 310_000, victimId: TARGET, position: { x: 1, y: 2 } })],
    );
    expect(runRules(RULES, timeline, puuidFor(TARGET))).toHaveLength(0);
  });

  it("ignores very early deaths", () => {
    const timeline = withStats(
      { 60_000: { 2: { currentGold: 5000 } } },
      [championKill({ timestamp: 90_000, victimId: TARGET, position: { x: 1, y: 2 } })],
    );
    expect(runRules(RULES, timeline, puuidFor(TARGET))).toHaveLength(0);
  });

  it("ignores teammates' deaths", () => {
    const timeline = withStats(
      { 300_000: { 4: { currentGold: 5000 } } },
      [championKill({ timestamp: 310_000, victimId: 4, position: { x: 1, y: 2 } })],
    );
    expect(runRules(RULES, timeline, puuidFor(TARGET))).toHaveLength(0);
  });

  it("treats the threshold boundary as not-a-finding", () => {
    const timeline = withStats(
      { 300_000: { 2: { currentGold: UNSPENT_GOLD_THRESHOLD - 1 } } },
      [championKill({ timestamp: 310_000, victimId: TARGET, position: { x: 1, y: 2 } })],
    );
    expect(runRules(RULES, timeline, puuidFor(TARGET))).toHaveLength(0);
  });
});

describe("rule registry", () => {
  it("registers all three rules with unique ids", () => {
    const ids = registeredRules.map((r) => r.id);
    expect(ids).toEqual([
      "deaths-without-vision",
      "lane-differential",
      "died-with-unspent-gold",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every rule a description", () => {
    for (const r of registeredRules) expect(r.description.length).toBeGreaterThan(0);
  });

  it("stamps every finding with the id of the rule that produced it", () => {
    const timeline = withStats(
      {
        300_000: { 2: { currentGold: 3000 } },
        600_000: { 2: { totalGold: 3000, xp: 3000 }, 7: { totalGold: 6000, xp: 6000 } },
      },
      [championKill({ timestamp: 310_000, victimId: TARGET, position: { x: 1, y: 2 } })],
    );

    const findings = runRules(registeredRules, timeline, puuidFor(TARGET));

    expect(findings.length).toBeGreaterThan(0);
    const known = new Set(registeredRules.map((r) => r.id));
    for (const f of findings) expect(known.has(f.ruleId)).toBe(true);
  });
});
