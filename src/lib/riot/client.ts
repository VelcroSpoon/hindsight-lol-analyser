import { getApiKey, regionalBaseUrl } from "./config";
import { riotRateLimiter } from "./rateLimiter";
import type { MatchTimelineDto } from "./types";

/**
 * Server-side Riot API client. Every outbound request goes through the shared
 * rate limiter, then a small retry loop for 429 (rate limit) and 5xx (Riot-side
 * transient) responses. Callers get parsed JSON or a thrown error.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const MAX_RETRIES = 3;

async function riotGet<T>(url: string): Promise<T> {
  const key = getApiKey();

  for (let attempt = 0; ; attempt++) {
    await riotRateLimiter.acquire();

    const res = await fetch(url, {
      headers: { "X-Riot-Token": key },
    });

    if (res.ok) {
      return (await res.json()) as T;
    }

    // Rate limited: honor Retry-After if present, else back off.
    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "1");
      const waitMs = (Number.isFinite(retryAfter) ? retryAfter : 1) * 1000;
      console.warn(`[riot] 429 rate limited, waiting ${waitMs}ms then retrying`);
      await sleep(waitMs);
      continue;
    }

    // Transient server error: exponential backoff.
    if (res.status >= 500 && attempt < MAX_RETRIES) {
      const waitMs = 500 * 2 ** attempt;
      console.warn(`[riot] ${res.status} from Riot, retrying in ${waitMs}ms`);
      await sleep(waitMs);
      continue;
    }

    const body = await res.text().catch(() => "");
    throw new Error(
      `Riot API request failed: ${res.status} ${res.statusText} for ${redact(url)}\n${body}`,
    );
  }
}

/** Strip the API key from a URL before it ever lands in a log or error. */
function redact(url: string): string {
  return url.replace(/api_key=[^&]+/i, "api_key=***");
}

// --- Account-V1 ------------------------------------------------------------

export interface RiotAccountDto {
  puuid: string;
  gameName: string;
  tagLine: string;
}

/** Resolve a Riot ID ("gameName#tagLine") to an account (incl. PUUID). */
export async function getAccountByRiotId(
  gameName: string,
  tagLine: string,
): Promise<RiotAccountDto> {
  const url =
    `${regionalBaseUrl()}/riot/account/v1/accounts/by-riot-id/` +
    `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
  return riotGet<RiotAccountDto>(url);
}

/** Convenience: accepts a full "gameName#tagLine" string. */
export async function resolveRiotId(riotId: string): Promise<RiotAccountDto> {
  const hash = riotId.lastIndexOf("#");
  if (hash <= 0 || hash === riotId.length - 1) {
    throw new Error(
      `Invalid Riot ID "${riotId}". Expected the form "gameName#tagLine".`,
    );
  }
  const gameName = riotId.slice(0, hash);
  const tagLine = riotId.slice(hash + 1);
  return getAccountByRiotId(gameName, tagLine);
}

// --- Match-V5 --------------------------------------------------------------

export interface RankedMatchIdsOptions {
  /** How many match IDs to return (Riot caps at 100). Default 20. */
  count?: number;
  /** How many to skip from the most recent. Default 0. */
  start?: number;
}

/**
 * Get recent RANKED match IDs for a PUUID, most recent first.
 * `type=ranked` covers both Solo/Duo (queue 420) and Flex (queue 440).
 */
export async function getRankedMatchIds(
  puuid: string,
  { count = 20, start = 0 }: RankedMatchIdsOptions = {},
): Promise<string[]> {
  const url =
    `${regionalBaseUrl()}/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids` +
    `?type=ranked&start=${start}&count=${Math.min(count, 100)}`;
  return riotGet<string[]>(url);
}

/** Fetch the full timeline for a match ID. */
export async function getMatchTimeline(
  matchId: string,
): Promise<MatchTimelineDto> {
  const url = `${regionalBaseUrl()}/lol/match/v5/matches/${encodeURIComponent(matchId)}/timeline`;
  return riotGet<MatchTimelineDto>(url);
}
