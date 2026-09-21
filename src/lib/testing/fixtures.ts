import type {
  MatchTimelineDto,
  Position,
  TimelineEvent,
  TimelineFrame,
} from "../riot/types";

/**
 * Builders for synthetic timelines used in tests.
 *
 * Real cached timelines are ~650KB each and encode a thousand incidental facts,
 * which makes them useless for asserting one behaviour. These builders produce
 * minimal timelines with exactly the events a test cares about, in the same
 * shape the Riot API actually returns (verified against real payloads —
 * see scripts/inspect-timeline.ts).
 */

export const FRAME_INTERVAL_MS = 60_000;

export interface BuildTimelineOptions {
  /** Events to distribute into frames by timestamp. */
  events?: TimelineEvent[];
  /**
   * Per-participant position samples: participantId -> [{ t, pos }]. Each is
   * placed in the frame whose timestamp matches, so tests can pin champions.
   */
  positions?: Record<number, { t: number; pos: Position }[]>;
  /** Number of 60s frames to generate. Default 10 (a ~10 minute game). */
  frameCount?: number;
  matchId?: string;
}

/** PUUIDs are opaque; tests just need stable distinct strings. */
export const puuidFor = (participantId: number): string =>
  `test-puuid-${String(participantId).padStart(2, "0")}`;

export function buildTimeline(opts: BuildTimelineOptions = {}): MatchTimelineDto {
  const {
    events = [],
    positions = {},
    frameCount = 10,
    matchId = "TEST_1",
  } = opts;

  const frames: TimelineFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const timestamp = i * FRAME_INTERVAL_MS;

    const participantFrames: TimelineFrame["participantFrames"] = {};
    for (let pid = 1; pid <= 10; pid++) {
      const sample = positions[pid]?.find((s) => s.t === timestamp);
      if (sample) {
        participantFrames[String(pid)] = {
          participantId: pid,
          position: sample.pos,
        };
      }
    }

    frames.push({
      timestamp,
      participantFrames,
      // An event belongs to the frame covering [timestamp, timestamp+interval).
      events: events.filter(
        (e) => e.timestamp >= timestamp && e.timestamp < timestamp + FRAME_INTERVAL_MS,
      ),
    });
  }

  return {
    metadata: {
      dataVersion: "2",
      matchId,
      participants: Array.from({ length: 10 }, (_, i) => puuidFor(i + 1)),
    },
    info: {
      frameInterval: FRAME_INTERVAL_MS,
      frames,
      participants: Array.from({ length: 10 }, (_, i) => ({
        participantId: i + 1,
        puuid: puuidFor(i + 1),
      })),
    },
  };
}

// --- event builders (shapes verified against real Riot payloads) ------------

export function championKill(opts: {
  timestamp: number;
  victimId: number;
  killerId?: number;
  position: Position;
}): TimelineEvent {
  return {
    type: "CHAMPION_KILL",
    timestamp: opts.timestamp,
    killerId: opts.killerId ?? 99,
    victimId: opts.victimId,
    position: opts.position,
  } as TimelineEvent;
}

export function wardPlaced(opts: {
  timestamp: number;
  creatorId: number;
  wardType?: string;
}): TimelineEvent {
  return {
    type: "WARD_PLACED",
    timestamp: opts.timestamp,
    creatorId: opts.creatorId,
    wardType: opts.wardType ?? "UNDEFINED",
  } as TimelineEvent;
}

export function wardKill(opts: {
  timestamp: number;
  killerId: number;
}): TimelineEvent {
  return {
    type: "WARD_KILL",
    timestamp: opts.timestamp,
    killerId: opts.killerId,
    wardType: "UNDEFINED",
  } as TimelineEvent;
}

export function eliteMonsterKill(opts: {
  timestamp: number;
  killerId: number;
  position: Position;
  monsterType?: string;
}): TimelineEvent {
  return {
    type: "ELITE_MONSTER_KILL",
    timestamp: opts.timestamp,
    killerId: opts.killerId,
    killerTeamId: opts.killerId <= 5 ? 100 : 200,
    monsterType: opts.monsterType ?? "DRAGON",
    position: opts.position,
  } as TimelineEvent;
}
