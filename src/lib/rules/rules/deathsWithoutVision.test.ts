import { describe, it, expect } from "vitest";
import { runRules } from "../engine";
import { deathsWithoutVisionRule, VISION_DISTANCE_UNITS } from "./deathsWithoutVision";
import {
  buildTimeline,
  championKill,
  wardPlaced,
  puuidFor,
  FRAME_INTERVAL_MS,
} from "../../testing/fixtures";

/**
 * Tests for the deaths-without-vision rule.
 *
 * The rule's job is to make one of THREE decisions per death: flag it, clear it
 * (a ward was confidently nearby), or abstain (position estimate too vague).
 * These tests pin down all three, plus the team/victim filtering.
 *
 * Wards are placed at the creator's position, so tests pin the creator with
 * frame samples at exact frame timestamps to control where a ward "is".
 */

const RULES = [deathsWithoutVisionRule];
const TARGET = 2; // the player under analysis (team 100)
const DEATH_SPOT = { x: 8000, y: 8000 };

describe("deathsWithoutVision", () => {
  it("flags a death when no friendly ward is live anywhere", () => {
    const timeline = buildTimeline({
      events: [championKill({ timestamp: 90_000, victimId: TARGET, killerId: 7, position: DEATH_SPOT })],
      positions: { [TARGET]: [{ t: 60_000, pos: DEATH_SPOT }, { t: 120_000, pos: DEATH_SPOT }] },
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("deaths-without-vision");
    expect(findings[0].gameTimeMs).toBe(90_000);
    expect(findings[0].position).toEqual(DEATH_SPOT);
    expect(findings[0].detail).toMatch(/no friendly wards up anywhere/);
  });

  it("clears a death when a friendly ward is confidently near the death spot", () => {
    // Ally 3 sits ON the death spot across the whole window and wards there at
    // a frame boundary, so the ward's position is pinned with zero gap.
    const ally = 3;
    const timeline = buildTimeline({
      events: [
        wardPlaced({ timestamp: 60_000, creatorId: ally }),
        championKill({ timestamp: 90_000, victimId: TARGET, killerId: 7, position: DEATH_SPOT }),
      ],
      positions: {
        [ally]: [
          { t: 60_000, pos: DEATH_SPOT },
          { t: 120_000, pos: DEATH_SPOT },
        ],
      },
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    expect(findings).toHaveLength(0);
  });

  it("flags a death when the only live friendly ward is far away", () => {
    const ally = 3;
    const farAway = { x: 1000, y: 1000 }; // ~9900 units from DEATH_SPOT
    const timeline = buildTimeline({
      events: [
        wardPlaced({ timestamp: 60_000, creatorId: ally }),
        championKill({ timestamp: 90_000, victimId: TARGET, killerId: 7, position: DEATH_SPOT }),
      ],
      positions: {
        [ally]: [
          { t: 60_000, pos: farAway },
          { t: 120_000, pos: farAway },
        ],
      },
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/nearest friendly ward was about/);
  });

  it("ignores ENEMY wards — they give the player no vision", () => {
    const enemy = 8; // team 200
    const timeline = buildTimeline({
      events: [
        wardPlaced({ timestamp: 60_000, creatorId: enemy }),
        championKill({ timestamp: 90_000, victimId: TARGET, killerId: 7, position: DEATH_SPOT }),
      ],
      positions: {
        [enemy]: [
          { t: 60_000, pos: DEATH_SPOT },
          { t: 120_000, pos: DEATH_SPOT },
        ],
      },
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    // Enemy ward sits on the death spot but must not clear the death.
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/no friendly wards up anywhere/);
  });

  it("only reports the analyzed player's own deaths", () => {
    const teammate = 4;
    const timeline = buildTimeline({
      events: [
        championKill({ timestamp: 90_000, victimId: teammate, killerId: 7, position: DEATH_SPOT }),
      ],
      positions: { [teammate]: [{ t: 60_000, pos: DEATH_SPOT }] },
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    expect(findings).toHaveLength(0);
  });

  it("treats a ward as expired after its assumed lifetime", () => {
    const ally = 3;
    // Ward at t=0, death at 5 minutes — well past WARD_LIFETIME_MS (150s).
    const timeline = buildTimeline({
      frameCount: 12,
      events: [
        wardPlaced({ timestamp: 0, creatorId: ally }),
        championKill({ timestamp: 300_000, victimId: TARGET, killerId: 7, position: DEATH_SPOT }),
      ],
      positions: {
        [ally]: [
          { t: 0, pos: DEATH_SPOT },
          { t: 300_000, pos: DEATH_SPOT },
        ],
      },
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/no friendly wards up anywhere/);
  });

  it("abstains instead of flagging when ward positions are too uncertain", () => {
    // Ally has frame samples only at 0 and 600_000, and wards at 300_000 —
    // a 5-minute gap to the nearest anchor, so the estimate is worthless.
    const ally = 3;
    const timeline = buildTimeline({
      frameCount: 12,
      events: [
        wardPlaced({ timestamp: 290_000, creatorId: ally }),
        championKill({ timestamp: 300_000, victimId: TARGET, killerId: 7, position: DEATH_SPOT }),
      ],
      positions: {
        [ally]: [
          { t: 0, pos: { x: 1000, y: 1000 } },
          { t: 600_000, pos: { x: 14000, y: 14000 } },
        ],
      },
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    // A live ward exists but can't be placed confidently -> stay silent.
    expect(findings).toHaveLength(0);
  });

  it("reports findings sorted by game time across multiple deaths", () => {
    const timeline = buildTimeline({
      frameCount: 12,
      events: [
        championKill({ timestamp: 400_000, victimId: TARGET, killerId: 7, position: DEATH_SPOT }),
        championKill({ timestamp: 120_000, victimId: TARGET, killerId: 8, position: DEATH_SPOT }),
        championKill({ timestamp: 260_000, victimId: TARGET, killerId: 9, position: DEATH_SPOT }),
      ],
    });

    const findings = runRules(RULES, timeline, puuidFor(TARGET));

    expect(findings.map((f) => f.gameTimeMs)).toEqual([120_000, 260_000, 400_000]);
  });

  it("respects the VISION_DISTANCE_UNITS threshold at its boundary", () => {
    const ally = 3;
    // Place the ward just INSIDE the threshold along the x axis.
    const justInside = { x: DEATH_SPOT.x - (VISION_DISTANCE_UNITS - 50), y: DEATH_SPOT.y };
    const timeline = buildTimeline({
      events: [
        wardPlaced({ timestamp: 60_000, creatorId: ally }),
        championKill({ timestamp: 90_000, victimId: TARGET, killerId: 7, position: DEATH_SPOT }),
      ],
      positions: {
        [ally]: [
          { t: 60_000, pos: justInside },
          { t: 120_000, pos: justInside },
        ],
      },
    });

    expect(runRules(RULES, timeline, puuidFor(TARGET))).toHaveLength(0);
  });

  it("produces a well-formed Finding", () => {
    const timeline = buildTimeline({
      events: [championKill({ timestamp: 90_000, victimId: TARGET, killerId: 7, position: DEATH_SPOT })],
      positions: { [TARGET]: [{ t: FRAME_INTERVAL_MS, pos: DEATH_SPOT }] },
    });

    const [f] = runRules(RULES, timeline, puuidFor(TARGET));

    expect(f.ruleId).toBe("deaths-without-vision");
    expect([1, 2, 3]).toContain(f.severity);
    expect(typeof f.title).toBe("string");
    expect(f.title.length).toBeGreaterThan(0);
    expect(typeof f.detail).toBe("string");
    expect(f.detail.length).toBeGreaterThan(0);
    expect(typeof f.gameTimeMs).toBe("number");
  });
});
