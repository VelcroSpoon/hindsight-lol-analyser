import "./loadEnv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TIMELINE_FILE } from "../src/lib/cache/timelineCache";

/**
 * Print one real example of each event type that could serve as an exact
 * position anchor (has a `position` and identifies a champion). Used to ground
 * the anchor extractor in real shapes before writing it.
 */
const CACHE_DIR = path.join(process.cwd(), "cache");
const TYPES = [
  "CHAMPION_KILL",
  "CHAMPION_SPECIAL_KILL",
  "BUILDING_KILL",
  "TURRET_PLATE_DESTROYED",
  "ELITE_MONSTER_KILL",
];

async function main() {
  const files = (await fs.readdir(CACHE_DIR)).filter((f) => TIMELINE_FILE.test(f));
  const timeline = JSON.parse(
    await fs.readFile(path.join(CACHE_DIR, files[0]), "utf8"),
  );
  const examples = new Map<string, unknown>();
  for (const frame of timeline.info.frames) {
    for (const ev of frame.events ?? []) {
      if (TYPES.includes(ev.type) && !examples.has(ev.type)) {
        examples.set(ev.type, ev);
      }
    }
  }
  for (const t of TYPES) {
    console.log(`\n### ${t}`);
    console.log(JSON.stringify(examples.get(t) ?? "(none)", null, 2));
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
