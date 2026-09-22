import "./loadEnv";
import { resolveRiotId, getRankedMatchIds } from "../src/lib/riot/client";
import { getTimelineCached, __cacheInternals } from "../src/lib/cache/timelineCache";

/**
 * Step 1 of bring-up: resolve a Riot ID, grab ONE recent ranked match, fetch +
 * cache its timeline. Prints where it landed on disk. Run:
 *
 *   RIOT_ID="gameName#tagLine" npm run fetch:one
 *
 * (or edit the fallback below). Inspect the shape afterwards with `npm run inspect`.
 */

const RIOT_ID = process.env.RIOT_ID ?? "REPLACE_ME#0000";

async function main() {
  if (RIOT_ID.startsWith("REPLACE_ME")) {
    throw new Error(
      'Set a real Riot ID: RIOT_ID="gameName#tagLine" npm run fetch:one',
    );
  }

  console.log(`Resolving Riot ID: ${RIOT_ID}`);
  const account = await resolveRiotId(RIOT_ID);
  console.log(`  -> PUUID ${account.puuid}`);

  console.log("Fetching most recent ranked match id...");
  const [matchId] = await getRankedMatchIds(account.puuid, { count: 1 });
  if (!matchId) {
    throw new Error("No ranked matches found for this account.");
  }
  console.log(`  -> ${matchId}`);

  console.log("Fetching + caching timeline...");
  await getTimelineCached(matchId);
  const file = await __cacheInternals.cachePath(matchId);
  console.log(`\nDone. Timeline cached at:\n  ${file}`);
  console.log(`\nNow run:  npm run inspect  (or: MATCH_ID=${matchId} npm run inspect)`);
}

main().catch((err) => {
  console.error("\nfetch:one failed:\n", err instanceof Error ? err.message : err);
  process.exit(1);
});
