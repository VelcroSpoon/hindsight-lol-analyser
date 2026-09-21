import { describe, it, expect } from "vitest";
import { collectGames } from "./collectGames";
import { buildTimeline } from "../testing/fixtures";

/**
 * A fake match history: "R" = remake, "G" = real game, "X" = timeline
 * unavailable. Records every page request so tests can check API usage.
 */
function fakeHistory(pattern: string) {
  const ids = [...pattern].map((kind, i) => ({ id: `NA1_${1000 - i}`, kind }));
  const pageCalls: [number, number][] = [];
  const realGame = buildTimeline({ frameCount: 25 }); // ~24 minutes
  const remake = buildTimeline({ frameCount: 2 }); // ends at 1:00
  return {
    pageCalls,
    fetchIds: async (start: number, count: number) => {
      pageCalls.push([start, count]);
      return ids.slice(start, start + count).map((m) => m.id);
    },
    loadTimeline: async (matchId: string) => {
      const kind = ids.find((m) => m.id === matchId)!.kind;
      return kind === "X" ? null : kind === "R" ? remake : realGame;
    },
  };
}

describe("collectGames", () => {
  it("makes a single request when there are no remakes", async () => {
    const h = fakeHistory("GGGGG" + "GGGGG");
    const r = await collectGames({ target: 5, ...h });

    expect(r.games).toHaveLength(5);
    expect(r.stop).toBe("target");
    expect(h.pageCalls).toEqual([[0, 5]]);
  });

  it("reads further back to replace remakes, asking only for what's missing", async () => {
    // 5 wanted; first page of 5 has 2 remakes, so ask for 2 more.
    const h = fakeHistory("GRGRG" + "GGGGG");
    const r = await collectGames({ target: 5, ...h });

    expect(r.games).toHaveLength(5);
    expect(r.stop).toBe("target");
    expect(h.pageCalls).toEqual([[0, 5], [5, 2]]);
    expect(r.entries.filter((e) => e.kind === "remake")).toHaveLength(2);
  });

  it("keeps going if the replacement page has remakes too", async () => {
    const h = fakeHistory("GGGGR" + "R" + "GGGG");
    const r = await collectGames({ target: 5, ...h });

    expect(r.games).toHaveLength(5);
    expect(h.pageCalls).toEqual([[0, 5], [5, 1], [6, 1]]);
  });

  it("replaces matches whose timeline can't be loaded", async () => {
    const h = fakeHistory("GXGGG" + "GG");
    const r = await collectGames({ target: 5, ...h });

    expect(r.games).toHaveLength(5);
    expect(r.entries.some((e) => e.kind === "unavailable")).toBe(true);
  });

  it("stops with fewer games when history runs out", async () => {
    const h = fakeHistory("GGRG");
    const r = await collectGames({ target: 5, ...h });

    expect(r.games).toHaveLength(3);
    expect(r.stop).toBe("exhausted");
  });

  it("never looks at more than maxMatchIds ids", async () => {
    const h = fakeHistory("R".repeat(50));
    const r = await collectGames({ target: 5, maxMatchIds: 10, ...h });

    expect(r.games).toHaveLength(0);
    expect(r.stop).toBe("cap");
    expect(r.seenIds).toHaveLength(10);
  });

  it("defaults the cap to twice the target", async () => {
    const h = fakeHistory("R".repeat(50));
    const r = await collectGames({ target: 5, ...h });

    expect(r.seenIds).toHaveLength(10);
    expect(r.stop).toBe("cap");
  });

  it("returns games and entries newest first", async () => {
    const h = fakeHistory("GRG" + "G");
    const r = await collectGames({ target: 3, ...h });

    expect(r.games.map((g) => g.matchId)).toEqual(["NA1_1000", "NA1_998", "NA1_997"]);
    expect(r.entries.map((e) => e.matchId)).toEqual(["NA1_1000", "NA1_999", "NA1_998", "NA1_997"]);
    expect(r.seenIds).toEqual(["NA1_1000", "NA1_999", "NA1_998", "NA1_997"]);
  });
});
