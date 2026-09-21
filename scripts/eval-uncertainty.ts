import "./loadEnv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TIMELINE_FILE } from "../src/lib/cache/timelineCache";
import { isRemake } from "../src/lib/timeline/gameInfo";
import {
  buildParticipantAnchors,
  estimateFromAnchors,
  gapToNearestAnchor,
  MAX_MOVE_SPEED_UNITS_PER_SEC,
} from "../src/lib/timeline/positionAnchors";
import type { MatchTimelineDto, Position } from "../src/lib/riot/types";

/**
 * Calibrate the position-uncertainty model against ground truth.
 *
 * `positionUncertainty` currently returns a WORST-CASE bound (gap x max move
 * speed). That's sound but very loose — champions don't sprint in a straight
 * line away from their last known point. Here we measure the ACTUAL error
 * distribution as a function of gap-to-nearest-anchor, using held-out deaths,
 * so the gate can be set from evidence instead of a bound.
 *
 *   npx tsx scripts/eval-uncertainty.ts
 */

const CACHE_DIR = path.join(process.cwd(), "cache");
const dist = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);
const BUCKETS = [0, 2000, 5000, 10000, 15000, 20000, 30000, Infinity];

function q(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

async function main() {
  const files = (await fs.readdir(CACHE_DIR)).filter(
    (f) => TIMELINE_FILE.test(f),
  );
  const rows: { gap: number; err: number }[] = [];
  let remakes = 0;

  for (const file of files) {
    const timeline: MatchTimelineDto = JSON.parse(
      await fs.readFile(path.join(CACHE_DIR, file), "utf8"),
    );
    if (isRemake(timeline)) {
      remakes++;
      continue;
    }
    for (const frame of timeline.info.frames) {
      for (const ev of frame.events ?? []) {
        const e = ev as { type: string; victimId?: number; position?: Position; timestamp: number };
        if (e.type !== "CHAMPION_KILL" || !e.position || !e.victimId) continue;
        const anchors = buildParticipantAnchors(timeline, e.victimId, {
          excludeDeathTimestamp: e.timestamp,
        });
        const est = estimateFromAnchors(anchors, e.timestamp);
        if (!est) continue;
        rows.push({
          gap: gapToNearestAnchor(anchors, e.timestamp),
          err: dist(est, e.position),
        });
      }
    }
  }

  console.log();
  console.log(`Actual position error vs. gap-to-nearest-anchor  (n=${rows.length}, ${remakes} remakes excluded)`);
  console.log();
  console.log(
    `${"gap (s)".padEnd(14)}${"n".padStart(6)}${"median".padStart(9)}${"p75".padStart(9)}` +
      `${"p90".padStart(9)}${"worst-case bound".padStart(19)}${"bound / p75".padStart(13)}`,
  );
  console.log("-".repeat(79));

  // Rows with fewer samples than this are shown, but too thin to calibrate from.
  const MIN_BUCKET = 30;
  const ratios: number[] = [];
  for (let i = 0; i < BUCKETS.length - 1; i++) {
    const lo = BUCKETS[i], hi = BUCKETS[i + 1];
    const inBucket = rows.filter((r) => r.gap >= lo && r.gap < hi);
    if (!inBucket.length) continue;
    const errs = inBucket.map((r) => r.err).sort((a, b) => a - b);
    const bound = ((hi === Infinity ? lo * 1.5 : hi) / 1000) * MAX_MOVE_SPEED_UNITS_PER_SEC;
    const label = hi === Infinity ? `${lo / 1000}+` : `${lo / 1000}–${hi / 1000}`;
    const p75 = q(errs, 0.75);
    const ratio = bound / p75;
    if (errs.length >= MIN_BUCKET) ratios.push(ratio);
    console.log(
      label.padEnd(14) +
        String(errs.length).padStart(6) +
        q(errs, 0.5).toFixed(0).padStart(9) +
        p75.toFixed(0).padStart(9) +
        q(errs, 0.9).toFixed(0).padStart(9) +
        bound.toFixed(0).padStart(19) +
        (ratio.toFixed(1) + "x").padStart(13) +
        (errs.length < MIN_BUCKET ? "  (too few samples to calibrate)" : ""),
    );
  }

  const all = rows.map((r) => r.err).sort((a, b) => a - b);
  console.log();
  console.log(`Overall: median ${q(all, 0.5).toFixed(0)}, p90 ${q(all, 0.9).toFixed(0)} units.`);
  console.log(
    `Per row, the worst-case bound is ${Math.min(...ratios).toFixed(1)}x to ${Math.max(...ratios).toFixed(1)}x ` +
      `the measured p75 error, so gating on measured error throws away far fewer wards.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
