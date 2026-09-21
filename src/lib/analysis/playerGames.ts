import { getLeaguePlatform, getRankedMatchIds, resolveRiotId } from "../riot/client";
import { regionForPlatform } from "../riot/config";
import { getTimelineCached, isCached, readCachedTimeline } from "../cache/timelineCache";
import { getCachedAccount, putCachedAccount } from "../cache/accountCache";
import { collectGames, type CollectResult } from "./collectGames";

/**
 * Load a player's N most recent real games, either from the cache alone or
 * live from Riot. Shared by the CLI (scripts/analyze.ts) and the web UI so the
 * two can never disagree about which games a player has.
 */

export interface PlayerGames extends CollectResult {
  /** Riot ID as Riot spells it (or as cached), e.g. "PlayerName#NA1". */
  riotId: string;
  puuid: string;
  /** Timelines read from /cache vs. downloaded during this call. */
  fromCache: number;
  fetched: number;
  /** How many match ids the account cache holds (after this call). */
  cachedMatchIds: number;
}

/** Cache only, no network. Returns null if this Riot ID has never been fetched. */
export async function loadCachedPlayerGames(
  riotId: string,
  target: number,
): Promise<PlayerGames | null> {
  const cached = await getCachedAccount(riotId);
  if (!cached) return null;

  let fromCache = 0;
  const result = await collectGames({
    target,
    fetchIds: async (start, count) => cached.matchIds.slice(start, start + count),
    loadTimeline: async (matchId) => {
      const timeline = await readCachedTimeline(matchId);
      if (timeline) fromCache++;
      return timeline;
    },
  });

  return {
    ...result,
    riotId: cached.riotId,
    puuid: cached.puuid,
    fromCache,
    fetched: 0,
    cachedMatchIds: cached.matchIds.length,
  };
}

/**
 * Live: resolve the Riot ID, read ranked match history, download any timeline
 * not already cached, and remember every match id seen. Throws on API errors
 * (missing/expired key, unknown Riot ID) — callers decide whether to fall back
 * to the cache.
 */
export async function fetchPlayerGames(riotId: string, target: number): Promise<PlayerGames> {
  const account = await resolveRiotId(riotId);
  const canonical = `${account.gameName}#${account.tagLine}`;
  // Match history only comes from the player's own region, so look it up.
  const region = regionForPlatform(await getLeaguePlatform(account.puuid));

  let fromCache = 0;
  let fetched = 0;
  const result = await collectGames({
    target,
    fetchIds: (start, count) => getRankedMatchIds(account.puuid, { start, count, region }),
    loadTimeline: async (matchId) => {
      if (await isCached(matchId)) {
        fromCache++;
        return readCachedTimeline(matchId);
      }
      fetched++;
      return getTimelineCached(matchId);
    },
  });

  await putCachedAccount(canonical, account, result.seenIds);
  const cached = await getCachedAccount(canonical);

  return {
    ...result,
    riotId: canonical,
    puuid: account.puuid,
    fromCache,
    fetched,
    cachedMatchIds: cached?.matchIds.length ?? result.seenIds.length,
  };
}
