/**
 * Types for the Match-V5 timeline payload.
 *
 * These mirror Riot's documented schema and are intentionally broad — the
 * event stream is a discriminated union keyed on `type`, and Riot ships more
 * event types than any one rule cares about. Rules should narrow to the events
 * they need and tolerate unknown ones.
 *
 * NOTE: refine these against a real cached payload before trusting them in rule
 * logic (that's exactly what scripts/inspect-timeline.ts is for).
 */

export interface Position {
  x: number;
  y: number;
}

/** Common shape shared by every timeline event; `type` is the discriminant. */
export interface TimelineEventBase {
  type: string;
  timestamp: number;
  [key: string]: unknown;
}

export interface ChampionKillEvent extends TimelineEventBase {
  type: "CHAMPION_KILL";
  killerId: number;
  victimId: number;
  /** Participant IDs credited with an assist (may be absent). */
  assistingParticipantIds?: number[];
  position: Position;
  bounty?: number;
  shutdownBounty?: number;
}

export type WardType =
  | "YELLOW_TRINKET"
  | "SIGHT_WARD"
  | "CONTROL_WARD"
  | "BLUE_TRINKET"
  | "TEEMO_MUSHROOM"
  | "UNDEFINED"
  | string;

// NOTE (confirmed against real match payloads): ward events carry NO
// position and no ward identity — only who and when. `wardType` is frequently
// "UNDEFINED". Any location-based vision logic must reconstruct ward position
// from the creator's frame position at placement time.
export interface WardPlacedEvent extends TimelineEventBase {
  type: "WARD_PLACED";
  creatorId: number;
  wardType: WardType;
}

export interface WardKillEvent extends TimelineEventBase {
  type: "WARD_KILL";
  killerId: number;
  wardType: WardType;
}

export type TimelineEvent =
  | ChampionKillEvent
  | WardPlacedEvent
  | WardKillEvent
  | TimelineEventBase;

/** Per-participant frame snapshot (position, gold, xp, etc.). */
export interface ParticipantFrame {
  participantId: number;
  position?: Position;
  currentGold?: number;
  totalGold?: number;
  level?: number;
  xp?: number;
  minionsKilled?: number;
  jungleMinionsKilled?: number;
  [key: string]: unknown;
}

export interface TimelineFrame {
  timestamp: number;
  events: TimelineEvent[];
  participantFrames: Record<string, ParticipantFrame>;
}

export interface TimelineParticipant {
  participantId: number;
  puuid: string;
}

export interface MatchTimelineInfo {
  frameInterval: number;
  frames: TimelineFrame[];
  participants: TimelineParticipant[];
  gameId?: number;
}

export interface MatchTimelineMetadata {
  dataVersion: string;
  matchId: string;
  participants: string[]; // PUUIDs, indexed to participantId - 1
}

export interface MatchTimelineDto {
  metadata: MatchTimelineMetadata;
  info: MatchTimelineInfo;
}
