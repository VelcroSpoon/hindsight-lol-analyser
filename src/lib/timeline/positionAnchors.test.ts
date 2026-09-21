import { describe, it, expect } from "vitest";
import {
  buildParticipantAnchors,
  estimateFromAnchors,
  gapToNearestAnchor,
  positionUncertainty,
} from "./positionAnchors";
import { buildTimeline, championKill, eliteMonsterKill } from "../testing/fixtures";

/**
 * Tests for the position estimator — the component the accuracy work is built
 * on. The important behaviours: event anchors actually get picked up, held-out
 * deaths are excluded (so evaluation can't cheat), interpolation is correct,
 * and uncertainty grows with the gap to the nearest anchor.
 */

describe("buildParticipantAnchors", () => {
  it("includes frame positions", () => {
    const timeline = buildTimeline({
      positions: { 3: [{ t: 0, pos: { x: 100, y: 200 } }] },
    });
    const anchors = buildParticipantAnchors(timeline, 3);
    expect(anchors).toContainEqual({ t: 0, pos: { x: 100, y: 200 }, exact: true, kind: "frame" });
  });

  it("adds an EXACT anchor at the participant's own death", () => {
    const timeline = buildTimeline({
      events: [championKill({ timestamp: 30_000, victimId: 3, position: { x: 5, y: 6 } })],
    });
    const anchors = buildParticipantAnchors(timeline, 3);
    const death = anchors.find((a) => a.kind === "death");
    expect(death).toEqual({ t: 30_000, pos: { x: 5, y: 6 }, exact: true, kind: "death" });
  });

  it("adds a SOFT anchor where the participant got a kill", () => {
    const timeline = buildTimeline({
      events: [championKill({ timestamp: 30_000, victimId: 8, killerId: 3, position: { x: 5, y: 6 } })],
    });
    const anchors = buildParticipantAnchors(timeline, 3);
    const kill = anchors.find((a) => a.kind === "kill");
    expect(kill?.exact).toBe(false);
    expect(kill?.pos).toEqual({ x: 5, y: 6 });
  });

  it("adds an objective anchor for elite monster kills", () => {
    const timeline = buildTimeline({
      events: [eliteMonsterKill({ timestamp: 30_000, killerId: 3, position: { x: 9, y: 9 } })],
    });
    expect(buildParticipantAnchors(timeline, 3).some((a) => a.kind === "objective")).toBe(true);
  });

  it("excludes a held-out death so evaluation cannot leak its own answer", () => {
    const timeline = buildTimeline({
      events: [championKill({ timestamp: 30_000, victimId: 3, position: { x: 5, y: 6 } })],
    });
    const anchors = buildParticipantAnchors(timeline, 3, { excludeDeathTimestamp: 30_000 });
    expect(anchors.some((a) => a.kind === "death")).toBe(false);
  });

  it("omits event anchors entirely when useEventAnchors is false", () => {
    const timeline = buildTimeline({
      events: [championKill({ timestamp: 30_000, victimId: 3, position: { x: 5, y: 6 } })],
      positions: { 3: [{ t: 0, pos: { x: 1, y: 1 } }] },
    });
    const anchors = buildParticipantAnchors(timeline, 3, { useEventAnchors: false });
    expect(anchors.every((a) => a.kind === "frame")).toBe(true);
  });

  it("does not attribute a minion-killed building to a champion", () => {
    const timeline = buildTimeline({
      events: [
        {
          type: "BUILDING_KILL",
          timestamp: 30_000,
          killerId: 0, // 0 = killed by a minion
          position: { x: 1, y: 1 },
        } as never,
      ],
    });
    expect(buildParticipantAnchors(timeline, 0).some((a) => a.kind === "building")).toBe(false);
  });

  it("returns anchors sorted by time", () => {
    const timeline = buildTimeline({
      events: [
        championKill({ timestamp: 90_000, victimId: 3, position: { x: 1, y: 1 } }),
        championKill({ timestamp: 30_000, victimId: 3, position: { x: 2, y: 2 } }),
      ],
      positions: { 3: [{ t: 60_000, pos: { x: 3, y: 3 } }] },
    });
    const ts = buildParticipantAnchors(timeline, 3).map((a) => a.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });
});

describe("estimateFromAnchors", () => {
  const anchors = [
    { t: 0, pos: { x: 0, y: 0 }, exact: true, kind: "frame" as const },
    { t: 10_000, pos: { x: 1000, y: 0 }, exact: true, kind: "frame" as const },
  ];

  it("interpolates linearly between two anchors", () => {
    expect(estimateFromAnchors(anchors, 5000)).toEqual({ x: 500, y: 0 });
  });

  it("returns the exact anchor position when asked at an anchor time", () => {
    expect(estimateFromAnchors(anchors, 10_000)).toEqual({ x: 1000, y: 0 });
  });

  it("clamps before the first and after the last anchor", () => {
    expect(estimateFromAnchors(anchors, -5000)).toEqual({ x: 0, y: 0 });
    expect(estimateFromAnchors(anchors, 999_999)).toEqual({ x: 1000, y: 0 });
  });

  it("returns null when there are no anchors", () => {
    expect(estimateFromAnchors([], 1000)).toBeNull();
  });
});

describe("uncertainty", () => {
  const anchors = [
    { t: 0, pos: { x: 0, y: 0 }, exact: true, kind: "frame" as const },
    { t: 60_000, pos: { x: 0, y: 0 }, exact: true, kind: "frame" as const },
  ];

  it("measures the gap to the nearest anchor in ms", () => {
    expect(gapToNearestAnchor(anchors, 1000)).toBe(1000);
    expect(gapToNearestAnchor(anchors, 59_000)).toBe(1000);
    expect(gapToNearestAnchor(anchors, 30_000)).toBe(30_000);
  });

  it("is near zero at an anchor and grows with the gap", () => {
    const atAnchor = positionUncertainty(anchors, 0);
    const nearby = positionUncertainty(anchors, 3000);
    const far = positionUncertainty(anchors, 25_000);

    expect(atAnchor).toBeLessThan(50);
    expect(nearby).toBeGreaterThan(atAnchor);
    expect(far).toBeGreaterThan(nearby);
  });

  it("increases monotonically with gap", () => {
    const gaps = [0, 2000, 5000, 10_000, 20_000, 30_000];
    const values = gaps.map((g) => positionUncertainty(anchors, g));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it("is Infinity when there are no anchors at all", () => {
    expect(positionUncertainty([], 1000)).toBe(Infinity);
  });
});
