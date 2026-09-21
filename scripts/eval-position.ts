import "./loadEnv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TIMELINE_FILE } from "../src/lib/cache/timelineCache";
import { isRemake } from "../src/lib/timeline/gameInfo";
import {
  buildParticipantAnchors,
  estimateFromAnchors,
} from "../src/lib/timeline/positionAnchors";
import type { MatchTimelineDto, Position } from "../src/lib/riot/types";

/**
 * Measure position-estimation error against HELD-OUT ground truth.
 *
 * Method (leave-one-out): every CHAMPION_KILL carries the victim's EXACT
 * position at an exact timestamp. For each death we remove that death from the
 * anchor set, estimate where the victim was, then compare the estimate to the
 * true coordinates. The death being predicted never informs its own prediction.
 *
 * Two estimators are compared on the identical set of deaths:
 *   baseline  — frames only (60s snapshots), the original approach
 *   anchored  — frames + event anchors (kills/objectives/buildings)
 *
 * This is fully machine-measurable — no human labeling involved.
 *
 *   npm run eval:position
 */

const CACHE_DIR = path.join(process.cwd(), "cache");

const dist = (a: Position, b: Position) => Math.hypot(a.x - b.x, a.y - b.y);

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function summarize(label: string, errors: number[]) {
  const s = [...errors].sort((a, b) => a - b);
  const mean = s.reduce((t, v) => t + v, 0) / s.length;
  return {
    label,
    n: s.length,
    mean,
    median: quantile(s, 0.5),
    p90: quantile(s, 0.9),
    within1400: (s.filter((e) => e <= 1400).length / s.length) * 100,
  };
}

async function main() {
  const files = (await fs.readdir(CACHE_DIR)).filter((f) => TIMELINE_FILE.test(f));
  if (files.length === 0) throw new Error("No cached timelines. Run npm run analyze first.");

  const baseline: number[] = [];
  const anchored: number[] = [];

  let remakes = 0;
  for (const file of files) {
    const timeline: MatchTimelineDto = JSON.parse(
      await fs.readFile(path.join(CACHE_DIR, file), "utf8"),
    );

    if (isRemake(timeline)) {
      remakes++;
      continue;
    }

    // Every death in the match is a ground-truth sample.
    for (const frame of timeline.info.frames) {
      for (const ev of frame.events ?? []) {
        const e = ev as { type: string; victimId?: number; position?: Position; timestamp: number };
        if (e.type !== "CHAMPION_KILL" || !e.position || !e.victimId) continue;

        const truth = e.position;
        const victim = e.victimId;

        // BASELINE: frames only.
        const framesOnly = buildParticipantAnchors(timeline, victim, {
          useEventAnchors: false,
        });
        const bEst = estimateFromAnchors(framesOnly, e.timestamp);

        // ANCHORED: frames + events, with THIS death held out.
        const withAnchors = buildParticipantAnchors(timeline, victim, {
          useEventAnchors: true,
          excludeDeathTimestamp: e.timestamp,
        });
        const aEst = estimateFromAnchors(withAnchors, e.timestamp);

        if (bEst && aEst) {
          baseline.push(dist(bEst, truth));
          anchored.push(dist(aEst, truth));
        }
      }
    }
  }

  const b = summarize("baseline (frames only)", baseline);
  const a = summarize("anchored (frames + events)", anchored);

  console.log(`\nPosition-estimation error vs. held-out ground truth`);
  console.log(`Matches: ${files.length - remakes} (${remakes} remakes excluded)   Deaths evaluated: ${b.n}`);
  console.log();

  const row = (r: ReturnType<typeof summarize>) =>
    `${r.label.padEnd(28)} ${r.mean.toFixed(0).padStart(8)} ${r.median
      .toFixed(0)
      .padStart(8)} ${r.p90.toFixed(0).padStart(8)} ${r.within1400.toFixed(1).padStart(9)}%`;

  console.log(`${"estimator".padEnd(28)} ${"mean".padStart(8)} ${"median".padStart(8)} ${"p90".padStart(8)} ${"<=1400".padStart(10)}`);
  console.log("-".repeat(68));
  console.log(row(b));
  console.log(row(a));

  const medianImp = ((b.median - a.median) / b.median) * 100;
  const meanImp = ((b.mean - a.mean) / b.mean) * 100;
  console.log(
    `\nImprovement: median error ${b.median.toFixed(0)} -> ${a.median.toFixed(0)} units ` +
      `(${medianImp.toFixed(1)}% lower), mean ${meanImp.toFixed(1)}% lower.`,
  );
  console.log(
    `Estimates within the 1400-unit vision threshold: ` +
      `${b.within1400.toFixed(1)}% -> ${a.within1400.toFixed(1)}%.`,
  );
}

main().catch((err) => {
  console.error("\neval:position failed:\n", err instanceof Error ? err.message : err);
  process.exit(1);
});
