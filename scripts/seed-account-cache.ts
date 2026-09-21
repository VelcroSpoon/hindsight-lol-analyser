import "./loadEnv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TIMELINE_FILE } from "../src/lib/cache/timelineCache";
import type { MatchTimelineDto } from "../src/lib/riot/types";

/**
 * One-off backfill: rebuild the account cache from timelines already on disk.
 *
 * Useful when the cache was populated before accounts.json existed, or when a
 * dev key has expired but the timelines are still local. Finds the PUUID present
 * in EVERY cached timeline (that's the account all these matches belong to) and
 * orders match ids newest-first by the numeric part of the match id.
 *
 *   npx tsx scripts/seed-account-cache.ts <gameName#tagLine>
 */

const CACHE_DIR = path.join(process.cwd(), "cache");

async function main() {
  const riotId = process.argv[2];
  if (!riotId || !riotId.includes("#")) {
    throw new Error('Usage: npx tsx scripts/seed-account-cache.ts "gameName#tagLine"');
  }

  const files = (await fs.readdir(CACHE_DIR)).filter(
    (f) => TIMELINE_FILE.test(f),
  );
  if (files.length === 0) throw new Error("No cached timelines found.");

  let common: Set<string> | null = null;
  const matchIds: string[] = [];

  for (const file of files) {
    const t: MatchTimelineDto = JSON.parse(
      await fs.readFile(path.join(CACHE_DIR, file), "utf8"),
    );
    matchIds.push(t.metadata.matchId);
    const puuids: Set<string> = new Set(t.metadata.participants);
    common = common
      ? new Set([...common].filter((p: string) => puuids.has(p)))
      : puuids;
  }

  const candidates = [...(common ?? [])];
  if (candidates.length !== 1) {
    throw new Error(
      `Expected exactly one PUUID common to all ${files.length} timelines, found ${candidates.length}. ` +
        `The cache may contain matches from multiple accounts.`,
    );
  }
  const puuid = candidates[0];

  // Match ids look like "NA1_1234567890" — sort by the numeric suffix, newest first.
  matchIds.sort((a, b) => Number(b.split("_")[1]) - Number(a.split("_")[1]));

  const [gameName, tagLine] = [
    riotId.slice(0, riotId.lastIndexOf("#")),
    riotId.slice(riotId.lastIndexOf("#") + 1),
  ];

  const file = path.join(CACHE_DIR, "accounts.json");
  let store: Record<string, unknown> = {};
  try {
    store = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    /* first write */
  }
  store[riotId.toLowerCase()] = {
    riotId,
    puuid,
    gameName,
    tagLine,
    matchIds,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(file, JSON.stringify(store, null, 2), "utf8");

  console.log(`Seeded ${riotId}`);
  console.log(`  puuid:   ${puuid}`);
  console.log(`  matches: ${matchIds.length} (newest ${matchIds[0]})`);
  console.log(`  written: ${file}`);
}

main().catch((err) => {
  console.error("\nseed failed:\n", err instanceof Error ? err.message : err);
  process.exit(1);
});
