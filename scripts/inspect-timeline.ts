import "./loadEnv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TIMELINE_FILE } from "../src/lib/cache/timelineCache";

/**
 * Step 2 of bring-up: read a cached timeline off disk and print its structure —
 * top-level keys, frame count/interval, participant mapping, a census of event
 * types, and one real example of each event type the first rule cares about.
 *
 * No network, no rule logic — this is purely to see the actual shapes before
 * writing parsing code against them.
 *
 *   npm run inspect                 # uses the newest file in /cache
 *   MATCH_ID=NA1_123 npm run inspect
 */

const CACHE_DIR = path.join(process.cwd(), "cache");
const EVENTS_OF_INTEREST = ["CHAMPION_KILL", "WARD_PLACED", "WARD_KILL"];

async function newestCacheFile(): Promise<string> {
  const entries = await fs.readdir(CACHE_DIR).catch(() => {
    throw new Error(`No /cache directory yet. Run npm run fetch:one first.`);
  });
  const jsons = entries.filter((f) => TIMELINE_FILE.test(f));
  if (jsons.length === 0) throw new Error("No cached timelines found in /cache.");

  const withTimes = await Promise.all(
    jsons.map(async (f) => ({
      f,
      mtime: (await fs.stat(path.join(CACHE_DIR, f))).mtimeMs,
    })),
  );
  withTimes.sort((a, b) => b.mtime - a.mtime);
  return path.join(CACHE_DIR, withTimes[0].f);
}

function pretty(v: unknown): string {
  return JSON.stringify(v, null, 2);
}

async function main() {
  const file = process.env.MATCH_ID
    ? path.join(CACHE_DIR, `${process.env.MATCH_ID}.json`)
    : await newestCacheFile();

  console.log(`Inspecting: ${file}\n`);
  const timeline = JSON.parse(await fs.readFile(file, "utf8"));

  // --- top level ---
  console.log("TOP-LEVEL KEYS:", Object.keys(timeline));
  console.log("metadata keys:", Object.keys(timeline.metadata));
  console.log("info keys:", Object.keys(timeline.info));
  console.log("matchId:", timeline.metadata.matchId);
  console.log("frameInterval (ms):", timeline.info.frameInterval);
  console.log("frame count:", timeline.info.frames.length);

  // --- participant mapping ---
  console.log("\nPARTICIPANTS (participantId -> puuid):");
  console.log("  metadata.participants (index+1 = participantId):");
  (timeline.metadata.participants as string[]).forEach((p, i) =>
    console.log(`    ${i + 1}: ${p}`),
  );
  if (timeline.info.participants) {
    console.log("  info.participants:", pretty(timeline.info.participants));
  }

  // --- event census ---
  const counts = new Map<string, number>();
  const examples = new Map<string, unknown>();
  for (const frame of timeline.info.frames) {
    for (const ev of frame.events ?? []) {
      counts.set(ev.type, (counts.get(ev.type) ?? 0) + 1);
      if (!examples.has(ev.type)) examples.set(ev.type, ev);
    }
  }

  console.log("\nEVENT TYPE CENSUS (type: count):");
  for (const [type, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  console.log("\n--- EXAMPLE EVENTS FOR THE FIRST RULE ---");
  for (const type of EVENTS_OF_INTEREST) {
    console.log(`\n### ${type} (${counts.get(type) ?? 0} total)`);
    console.log(examples.has(type) ? pretty(examples.get(type)) : "  (none in this match)");
  }

  // --- one participantFrame, to see what per-frame position data looks like ---
  const firstFrameWithParts = timeline.info.frames.find(
    (f: { participantFrames?: Record<string, unknown> }) =>
      f.participantFrames && Object.keys(f.participantFrames).length > 0,
  );
  if (firstFrameWithParts) {
    const key = Object.keys(firstFrameWithParts.participantFrames)[0];
    console.log("\n--- EXAMPLE participantFrame (participant " + key + ") ---");
    console.log(pretty(firstFrameWithParts.participantFrames[key]));
  }
}

main().catch((err) => {
  console.error("\ninspect failed:\n", err instanceof Error ? err.message : err);
  process.exit(1);
});
