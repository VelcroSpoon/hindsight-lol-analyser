import "./loadEnv";
import { getCachedAccount, listCachedAccounts } from "../src/lib/cache/accountCache";
import { runRules } from "../src/lib/rules/engine";
import { rules } from "../src/lib/rules/registry";
import type { Finding } from "../src/lib/rules/finding";
import { formatGameTime } from "../src/lib/rules/util";
import { DEFAULT_MAX_MATCH_ID_FACTOR } from "../src/lib/analysis/collectGames";
import {
  fetchPlayerGames,
  loadCachedPlayerGames,
  type PlayerGames,
} from "../src/lib/analysis/playerGames";

/**
 * Analyze a player's recent ranked games and print findings.
 *
 *   npm run analyze -- <gameName#tagLine> [--games N] [--offline]
 *   npm run analyze -- --list        # show cached (demo-ready) accounts
 *
 * --games N counts REAL games: remakes are skipped and replaced by reading
 * further back through match history (looking at no more than 2N match ids).
 *
 * Cache-first: timelines and account/match-id lookups are read from /cache when
 * present. With --offline (or when no API key is available) it runs entirely
 * from cache — no key required, which keeps the demo working after a dev key
 * expires.
 */

interface Args {
  riotId: string;
  games: number;
  offline: boolean;
  list: boolean;
}

function parseArgs(argv: string[]): Args {
  const rest: string[] = [];
  let games = 20;
  let offline = false;
  let list = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offline") offline = true;
    else if (a === "--list") list = true;
    else if (a === "--games" || a === "-n") games = Number(argv[++i]);
    else if (a.startsWith("--games=")) games = Number(a.split("=")[1]);
    else if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
    else rest.push(a);
  }

  if (!Number.isFinite(games) || games < 1) throw new Error("--games must be a positive number.");

  return {
    riotId: rest[0] ?? process.env.RIOT_ID ?? "",
    games,
    offline,
    list,
  };
}

function printFindings(matchId: string, findings: Finding[]): void {
  const header = `── ${matchId} ─ ${findings.length} finding(s) `;
  console.log("\n" + header + "─".repeat(Math.max(0, 60 - header.length)));
  if (findings.length === 0) {
    console.log("   (clean — no findings)");
    return;
  }
  for (const f of findings) {
    const sev = ["", "info", "WARN", "CRIT"][f.severity] ?? String(f.severity);
    console.log(`   [${formatGameTime(f.gameTimeMs)}] (${sev}) ${f.title}`);
    console.log(`        ${f.detail}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    const accounts = await listCachedAccounts();
    if (accounts.length === 0) {
      console.log("No cached accounts yet. Run: npm run analyze -- <gameName#tagLine>");
      return;
    }
    console.log("Cached accounts (runnable with --offline):");
    for (const a of accounts) {
      console.log(`  ${a.riotId}  —  ${a.matchIds.length} match ids, updated ${a.updatedAt}`);
    }
    return;
  }

  if (!args.riotId) {
    throw new Error('Pass a Riot ID: npm run analyze -- "gameName#tagLine"');
  }

  const hasKey = Boolean(process.env.RIOT_API_KEY?.trim());
  let offline = args.offline;
  if (!hasKey && !offline) {
    console.log("No RIOT_API_KEY set — running in offline (cache-only) mode.\n");
    offline = true;
  }

  // --- collect N real games (live if possible, else cache) -----------------
  // Remakes are replaced by reading further back through match history.
  console.log(
    `Collecting ${args.games} ranked games for ${args.riotId}` +
      (offline ? " (offline, cache only)" : "") +
      "...",
  );
  let result: PlayerGames | null = null;
  if (!offline) {
    try {
      result = await fetchPlayerGames(args.riotId, args.games);
    } catch (err) {
      // A dead/expired key shouldn't kill the run if we already have the data.
      if (!(await getCachedAccount(args.riotId))) throw err;
      console.warn(
        `Live lookup failed (${err instanceof Error ? err.message.split("\n")[0] : err}).\n` +
          `Falling back to cache.\n`,
      );
      offline = true;
    }
  }
  result ??= await loadCachedPlayerGames(args.riotId, args.games);
  if (!result) {
    const known = (await listCachedAccounts()).map((a) => a.riotId);
    throw new Error(
      `"${args.riotId}" is not cached, and there's no API key to fetch it.` +
        (known.length
          ? `\nCached accounts you can analyze offline: ${known.join(", ")}`
          : "\nRun once with a valid RIOT_API_KEY to populate the cache."),
    );
  }
  const { puuid, fromCache, fetched } = result;

  // --- run the rules and print ---------------------------------------------
  let totalFindings = 0;
  for (const entry of result.entries) {
    if (entry.kind === "game") {
      const findings = runRules(rules, entry.timeline, puuid);
      totalFindings += findings.length;
      printFindings(entry.matchId, findings);
    } else if (entry.kind === "remake") {
      // Remakes are not real games: counting them as "clean" would flatter the player.
      const ended = formatGameTime(entry.durationMs);
      console.log();
      console.log(`── ${entry.matchId} ─ remake (ended at ${ended}), skipped ${"─".repeat(12)}`);
    } else {
      console.log();
      console.log(`── ${entry.matchId} ─ not cached (offline), skipped ${"─".repeat(14)}`);
    }
  }

  const remakes = result.entries.filter((e) => e.kind === "remake").length;
  const unavailable = result.entries.filter((e) => e.kind === "unavailable").length;
  console.log();
  console.log("═".repeat(60));
  console.log(
    `Done. ${result.games.length} games analyzed` +
      (remakes ? `, ${remakes} remake(s) skipped` : "") +
      (unavailable ? `, ${unavailable} not cached` : "") +
      ` — ${fromCache} read from cache, ${fetched} fetched. ` +
      `${totalFindings} total finding(s).`,
  );

  if (result.stop !== "target") {
    const why =
      result.stop === "cap"
        ? `stopped after checking ${result.seenIds.length} matches (the limit is ${DEFAULT_MAX_MATCH_ID_FACTOR}x the games asked for).`
        : offline
          ? `only ${result.cachedMatchIds} matches are cached. Run with an API key to fetch more.`
          : "there are no more ranked games in this account's history.";
    console.log(`Asked for ${args.games} games, found ${result.games.length}: ${why}`);
  }
}

main().catch((err) => {
  console.error("\nanalyze failed:\n", err instanceof Error ? err.message : err);
  process.exit(1);
});
