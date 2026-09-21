import type { MatchTimelineDto, Position, TimelineEvent } from "../riot/types";

/** Shared, framework-free helpers for rules. Pure functions only. */

/** participantIds 1–5 are team 100; 6–10 are team 200. */
export const sameTeam = (a: number, b: number): boolean => a <= 5 === b <= 5;

export const distance = (p: Position, q: Position): number =>
  Math.hypot(p.x - q.x, p.y - q.y);

/** Flatten every event across all frames (events live per-frame in the timeline). */
export function allEvents(timeline: MatchTimelineDto): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const frame of timeline.info.frames) {
    if (frame.events) out.push(...frame.events);
  }
  return out;
}

/** 1659 -> "1,659". Findings are read by players; big numbers get separators. */
export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** ms -> "m:ss" game clock. */
export function formatGameTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * The frame at or immediately before `t` (frames are every `frameInterval` ms).
 * Returns null if the timeline has no frame at/below t.
 */
export function frameAtOrBefore(timeline: MatchTimelineDto, t: number) {
  let best = null as MatchTimelineDto["info"]["frames"][number] | null;
  for (const f of timeline.info.frames) {
    if (f.timestamp <= t && (!best || f.timestamp > best.timestamp)) best = f;
  }
  return best;
}
