import { promises as fs } from "node:fs";
import path from "node:path";
import { getMatchTimeline } from "../riot/client";
import type { MatchTimelineDto } from "../riot/types";

/**
 * Disk cache for match timelines. Every fetched timeline is written to
 * /cache/{matchId}.json immediately and read back on subsequent runs, so we
 * never re-fetch a match ID we already have. Timeline data is immutable once a
 * game is over, so there's no staleness to worry about.
 */

const CACHE_DIR = path.join(process.cwd(), "cache");

/**
 * Filenames of cached timelines look like "NA1_1234567890.json". Other files
 * live in /cache too (accounts.json), so anything that scans the directory for
 * timelines must filter with this rather than on the ".json" extension.
 */
export const TIMELINE_FILE = /^[A-Z0-9]+_[0-9]+[.]json$/;

function cachePath(matchId: string): string {
  // Match IDs look like "NA1_1234567890" — safe as a filename, but guard anyway.
  const safe = matchId.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(CACHE_DIR, `${safe}.json`);
}

async function ensureCacheDir(): Promise<void> {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

/** True if a timeline for this match ID is already on disk. */
export async function isCached(matchId: string): Promise<boolean> {
  try {
    await fs.access(cachePath(matchId));
    return true;
  } catch {
    return false;
  }
}

/** Read a cached timeline, or null if it isn't on disk. */
export async function readCachedTimeline(
  matchId: string,
): Promise<MatchTimelineDto | null> {
  try {
    const raw = await fs.readFile(cachePath(matchId), "utf8");
    return JSON.parse(raw) as MatchTimelineDto;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeCachedTimeline(
  matchId: string,
  timeline: MatchTimelineDto,
): Promise<void> {
  await ensureCacheDir();
  // Write to a temp file then rename, so a crash mid-write can't leave a
  // half-written JSON file that later reads as corrupt.
  const finalPath = cachePath(matchId);
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(timeline), "utf8");
  await fs.rename(tmpPath, finalPath);
}

/**
 * Get a timeline, preferring the disk cache. On a cache miss, fetch from Riot,
 * write it to disk immediately, then return it.
 */
export async function getTimelineCached(
  matchId: string,
): Promise<MatchTimelineDto> {
  const cached = await readCachedTimeline(matchId);
  if (cached) return cached;

  const timeline = await getMatchTimeline(matchId);
  await writeCachedTimeline(matchId, timeline);
  return timeline;
}

export const __cacheInternals = { CACHE_DIR, cachePath };
