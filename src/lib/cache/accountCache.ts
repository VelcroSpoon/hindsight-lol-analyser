import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveRiotId, type RiotAccountDto } from "../riot/client";
import { cacheDir } from "../storage";

/**
 * Caches Riot ID -> account (PUUID) and the ranked match-id list, so a full
 * analysis can run with NO network and NO API key once a player has been seen
 * once. Riot dev keys expire every 24h; this keeps the demo path working.
 *
 * Stored at /cache/accounts.json, keyed by lowercased Riot ID.
 */

async function accountsFile(): Promise<string> {
  return path.join(await cacheDir(), "accounts.json");
}

export interface CachedAccount {
  riotId: string;
  puuid: string;
  gameName: string;
  tagLine: string;
  /** Most recent ranked match ids we've seen, newest first. */
  matchIds: string[];
  updatedAt: string;
}

type AccountStore = Record<string, CachedAccount>;

async function readStore(): Promise<AccountStore> {
  try {
    return JSON.parse(await fs.readFile(await accountsFile(), "utf8")) as AccountStore;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writeStore(store: AccountStore): Promise<void> {
  await fs.mkdir(await cacheDir(), { recursive: true });
  const file = await accountsFile();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function getCachedAccount(riotId: string): Promise<CachedAccount | null> {
  const store = await readStore();
  return store[riotId.toLowerCase()] ?? null;
}

/**
 * Union of match-id lists, newest first. Match ids end in an increasing number
 * ("NA1_1234567890"), so sorting on it orders them by recency. Used so that
 * caching a short list never forgets ids a longer run already saved.
 */
export function mergeMatchIds(...lists: string[][]): string[] {
  const num = (id: string) => Number(id.slice(id.lastIndexOf("_") + 1));
  return [...new Set(lists.flat())].sort((a, b) => num(b) - num(a));
}

export async function putCachedAccount(
  riotId: string,
  account: RiotAccountDto,
  matchIds: string[],
): Promise<void> {
  const store = await readStore();
  store[riotId.toLowerCase()] = {
    riotId,
    puuid: account.puuid,
    gameName: account.gameName,
    tagLine: account.tagLine,
    matchIds: mergeMatchIds(matchIds, store[riotId.toLowerCase()]?.matchIds ?? []),
    updatedAt: new Date().toISOString(),
  };
  await writeStore(store);
}

/** List every Riot ID we have cached (for the demo path / --list). */
export async function listCachedAccounts(): Promise<CachedAccount[]> {
  return Object.values(await readStore());
}

/**
 * Resolve a Riot ID, preferring cache. With `offline`, never touches the
 * network and throws if the account isn't cached.
 */
export async function resolveAccountCached(
  riotId: string,
  offline: boolean,
): Promise<CachedAccount> {
  const cached = await getCachedAccount(riotId);
  if (cached) return cached;
  if (offline) {
    const known = (await listCachedAccounts()).map((a) => a.riotId);
    throw new Error(
      `"${riotId}" is not in the cache and --offline was set.` +
        (known.length ? `\nCached accounts: ${known.join(", ")}` : ""),
    );
  }
  const account = await resolveRiotId(riotId);
  return {
    riotId,
    puuid: account.puuid,
    gameName: account.gameName,
    tagLine: account.tagLine,
    matchIds: [],
    updatedAt: new Date().toISOString(),
  };
}
