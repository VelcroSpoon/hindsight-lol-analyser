import type { MatchTimelineDto } from "../riot/types";
import { gameDurationMs, isRemake } from "../timeline/gameInfo";

/**
 * Collect N REAL games for a player, reading further back through match history
 * to replace any remakes (or timelines we can't load) along the way.
 *
 * The first page asks for exactly `target` match ids. If some turn out to be
 * remakes, the next page asks only for as many as are still missing — so a
 * clean history costs no extra requests, and each remake costs one more
 * timeline fetch. Collection stops when it has `target` games, when history
 * runs out, or when it has looked at `maxMatchIds` ids (a hard cap so a long
 * streak of remakes can't eat the rate limit).
 *
 * I/O is injected, so this is testable without the network and works the same
 * online (Riot API) or offline (cached id list).
 */

/** By default, look at no more than this many ids per real game wanted. */
export const DEFAULT_MAX_MATCH_ID_FACTOR = 2;

/** Riot caps a single match-id request at 100. */
const MAX_PAGE_SIZE = 100;

export type CollectedEntry =
  | { kind: "game"; matchId: string; timeline: MatchTimelineDto }
  | { kind: "remake"; matchId: string; durationMs: number }
  | { kind: "unavailable"; matchId: string };

export type StopReason = "target" | "exhausted" | "cap";

export interface CollectResult {
  /** Every match looked at, newest first, with what happened to it. */
  entries: CollectedEntry[];
  /** Just the real games, newest first. */
  games: { matchId: string; timeline: MatchTimelineDto }[];
  /** Every match id fetched, in order — worth caching for offline runs. */
  seenIds: string[];
  /** Why collection ended. Anything but "target" means fewer games than asked for. */
  stop: StopReason;
}

export interface CollectOptions {
  /** How many real (non-remake) games to collect. */
  target: number;
  /** Hard cap on match ids examined. Default: target x DEFAULT_MAX_MATCH_ID_FACTOR. */
  maxMatchIds?: number;
  /** Return up to `count` match ids starting `start` back from the most recent. */
  fetchIds(start: number, count: number): Promise<string[]>;
  /** Return the timeline for a match, or null if it can't be had (e.g. offline, not cached). */
  loadTimeline(matchId: string): Promise<MatchTimelineDto | null>;
}

export async function collectGames(opts: CollectOptions): Promise<CollectResult> {
  const { target, fetchIds, loadTimeline } = opts;
  const maxMatchIds = opts.maxMatchIds ?? target * DEFAULT_MAX_MATCH_ID_FACTOR;

  const entries: CollectedEntry[] = [];
  const games: CollectResult["games"] = [];
  const seenIds: string[] = [];
  let start = 0;

  while (games.length < target) {
    const budget = maxMatchIds - seenIds.length;
    if (budget <= 0) return { entries, games, seenIds, stop: "cap" };

    const count = Math.min(target - games.length, budget, MAX_PAGE_SIZE);
    const ids = await fetchIds(start, count);
    start += ids.length;

    for (const matchId of ids) {
      seenIds.push(matchId);
      const timeline = await loadTimeline(matchId);
      if (!timeline) {
        entries.push({ kind: "unavailable", matchId });
      } else if (isRemake(timeline)) {
        entries.push({ kind: "remake", matchId, durationMs: gameDurationMs(timeline) });
      } else {
        entries.push({ kind: "game", matchId, timeline });
        games.push({ matchId, timeline });
      }
    }

    // A short page means there's no more history to read.
    if (ids.length < count && games.length < target) {
      return { entries, games, seenIds, stop: "exhausted" };
    }
  }

  return { entries, games, seenIds, stop: "target" };
}
