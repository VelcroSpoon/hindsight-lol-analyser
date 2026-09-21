import { describe, it, expect } from "vitest";
import { gameDurationMs, isRemake, REMAKE_MAX_DURATION_MS } from "./gameInfo";
import { buildTimeline } from "../testing/fixtures";
import type { TimelineEvent } from "../riot/types";

const gameEnd = (timestamp: number): TimelineEvent =>
  ({ type: "GAME_END", timestamp, winningTeam: 100 }) as TimelineEvent;

describe("gameDurationMs", () => {
  it("uses the GAME_END event when present", () => {
    // 3 frames (0, 60s, 120s) but the game ended at 72s, inside the 60s frame.
    const timeline = buildTimeline({ frameCount: 3, events: [gameEnd(72_000)] });
    expect(gameDurationMs(timeline)).toBe(72_000);
  });

  it("falls back to the last frame when there is no GAME_END", () => {
    expect(gameDurationMs(buildTimeline({ frameCount: 20 }))).toBe(19 * 60_000);
  });
});

describe("isRemake", () => {
  it("flags games that ended in the first few minutes", () => {
    // Shapes of the real remakes in the cache: ended at 1:12 and 2:09.
    expect(isRemake(buildTimeline({ frameCount: 3, events: [gameEnd(72_000)] }))).toBe(true);
    expect(isRemake(buildTimeline({ frameCount: 4, events: [gameEnd(129_000)] }))).toBe(true);
  });

  it("does not flag real games", () => {
    // Shortest real game in the cache ended at 17:05.
    expect(isRemake(buildTimeline({ frameCount: 18, events: [gameEnd(1_025_000)] }))).toBe(false);
  });

  it("puts the boundary at REMAKE_MAX_DURATION_MS", () => {
    const frames = Math.ceil(REMAKE_MAX_DURATION_MS / 60_000) + 1;
    const at = (ms: number) => buildTimeline({ frameCount: frames, events: [gameEnd(ms)] });
    expect(isRemake(at(REMAKE_MAX_DURATION_MS - 1))).toBe(true);
    expect(isRemake(at(REMAKE_MAX_DURATION_MS))).toBe(false);
  });
});
