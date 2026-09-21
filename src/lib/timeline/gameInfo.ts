import type { MatchTimelineDto } from "../riot/types";

/**
 * Game-level facts derived from a timeline. Pure.
 */

/**
 * Games shorter than this are treated as remakes and excluded from analysis.
 *
 * A remake ends a few minutes in (the vote opens around 3:00), while a real
 * ranked game can't be surrendered before 15:00. In the cached data the
 * longest remake ended at 2:09 and the shortest real game at 17:05, so 5
 * minutes sits well clear of both. The timeline has no explicit remake flag
 * (the Match-V5 match endpoint does, but that needs a live key), so length is
 * the signal.
 */
export const REMAKE_MAX_DURATION_MS = 5 * 60_000;

/** The GAME_END event, as Riot records it (verified against real payloads). */
export interface GameEndEvent {
  type: "GAME_END";
  /** Game clock at the end, in ms. */
  timestamp: number;
  /** Wall-clock time the game ended, epoch ms. */
  realTimestamp?: number;
  /** 100 (blue) or 200 (red). */
  winningTeam?: number;
}

export function gameEndEvent(timeline: MatchTimelineDto): GameEndEvent | null {
  const frames = timeline.info.frames;
  for (let i = frames.length - 1; i >= 0; i--) {
    const end = frames[i].events?.find((e) => e.type === "GAME_END");
    if (end) return end as unknown as GameEndEvent;
  }
  return null;
}

/** How long the game lasted, in ms: the GAME_END event, else the last frame. */
export function gameDurationMs(timeline: MatchTimelineDto): number {
  const end = gameEndEvent(timeline);
  if (end) return end.timestamp;
  const frames = timeline.info.frames;
  return frames.length ? frames[frames.length - 1].timestamp : 0;
}

/** Did this participant's team win? null if the timeline doesn't say. */
export function didWin(timeline: MatchTimelineDto, participantId: number): boolean | null {
  const winner = gameEndEvent(timeline)?.winningTeam;
  if (winner !== 100 && winner !== 200) return null;
  return (participantId <= 5 ? 100 : 200) === winner;
}

/**
 * True if this "game" was a remake. Remakes have almost no events, so rules
 * find nothing and they'd otherwise be counted as clean games — making a
 * player look better than they are.
 */
export function isRemake(timeline: MatchTimelineDto): boolean {
  return gameDurationMs(timeline) < REMAKE_MAX_DURATION_MS;
}
