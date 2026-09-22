import { promises as fs } from "node:fs";
import path from "node:path";
import type { MatchTimelineDto } from "../riot/types";
import type { Finding } from "../rules/finding";
import { participantIdForPuuid } from "../rules/engine";
import { allEvents, formatGameTime } from "../rules/util";
import { championNames, describeParticipant } from "../timeline/champions";
import { dataLocation } from "../storage";

/**
 * labels.json: hand-checked verdicts on findings, used to measure precision.
 *
 * Two writers share this file — `npm run label` (builds a worksheet) and the
 * match page (Right / Wrong / Can't tell buttons) — so every write goes through
 * here. The rule that matters: a verdict someone entered is NEVER dropped.
 * Labels take real time to collect.
 */

/** tp = the finding was right, fp = it was wrong, unsure = couldn't tell. */
export type Verdict = "tp" | "fp" | "unsure";
export const VERDICTS: readonly Verdict[] = ["tp", "fp", "unsure"];

export interface LabelRow {
  matchId: string;
  gameTime: string;
  /** Your champion and side, e.g. "Master Yi (blue)". Switch the replay fog to this side. */
  you: string;
  /** Who got the kill, when the finding is one of your deaths. */
  killedBy?: string;
  /** Who assisted on that kill. */
  assists?: string[];
  ruleId: string;
  title: string;
  detail: string;
  gameTimeMs: number;
  /**
   * Set (1, 2, ...) when a rule reports more than one finding at the same game
   * time — e.g. both a gold and an XP deficit at 10:00. Order follows the order
   * the rule emits them. Absent for the first (usual) one.
   */
  occurrence?: number;
  /** "" until someone judges it. */
  verdict: Verdict | "";
  /** Optional free-text note. */
  note?: string;
}

export const LABELS_FILE = path.join(process.cwd(), "labels.json");

/**
 * Answers are only worth collecting where they'll last. On a host with only
 * temporary storage (e.g. Vercel) they would silently vanish, so judging is
 * turned off there instead.
 */
export async function canSaveLabels(): Promise<boolean> {
  return (await dataLocation()).persistent;
}

/**
 * A finding is identified by its match, rule and game time, plus an occurrence
 * number when one rule reports several findings at the same moment.
 */
export function labelKey(r: {
  matchId: string;
  ruleId: string;
  gameTimeMs: number;
  occurrence?: number;
}): string {
  const base = `${r.matchId}|${r.ruleId}|${r.gameTimeMs}`;
  return r.occurrence ? `${base}#${r.occurrence}` : base;
}

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
}

// --- building rows (pure) ---------------------------------------------------

interface KillEvent {
  type: string;
  timestamp: number;
  victimId?: number;
  killerId?: number;
  assistingParticipantIds?: number[];
}

/**
 * Worksheet rows for one game's findings, with the context a person needs to
 * find the moment in a replay. Verdicts start empty.
 */
export function labelRowsFor(
  matchId: string,
  timeline: MatchTimelineDto,
  puuid: string,
  findings: Finding[],
): LabelRow[] {
  const pid = participantIdForPuuid(timeline, puuid);
  if (pid === null) return [];
  const names = championNames(timeline);
  const myDeaths = allEvents(timeline).filter(
    (e) => e.type === "CHAMPION_KILL" && (e as KillEvent).victimId === pid,
  ) as KillEvent[];

  const seen = new Map<string, number>();
  return findings.map((f) => {
    const slot = `${f.ruleId}|${f.gameTimeMs}`;
    const occurrence = seen.get(slot) ?? 0;
    seen.set(slot, occurrence + 1);
    // Death-based findings are stamped with the exact death timestamp.
    const death = myDeaths.find((d) => d.timestamp === f.gameTimeMs);
    // Built in reading order; undefined fields are dropped from the JSON.
    return {
      matchId,
      gameTime: formatGameTime(f.gameTimeMs),
      you: describeParticipant(names, pid),
      killedBy: death ? describeParticipant(names, death.killerId ?? 0) : undefined,
      assists: death
        ? (death.assistingParticipantIds ?? []).map((id) => describeParticipant(names, id))
        : undefined,
      ruleId: f.ruleId,
      title: f.title,
      detail: f.detail,
      gameTimeMs: f.gameTimeMs,
      occurrence: occurrence || undefined,
      verdict: "",
    };
  });
}

// --- file access --------------------------------------------------------------

/** All rows. A missing file is an empty list; a corrupt one is an error, never overwritten. */
export async function readLabels(file = LABELS_FILE): Promise<LabelRow[]> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error(`${file} should contain a JSON array.`);
  return rows as LabelRow[];
}

async function writeLabels(rows: LabelRow[], file: string): Promise<void> {
  // Temp file + rename, so a crash mid-write can't leave half a file.
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2), "utf8");
  await fs.rename(tmp, file);
}

// One write at a time within this process: two quick clicks must not race a
// read-modify-write and lose one of the answers.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Record (or clear, with "") the verdict for one finding. Creates the row if
 * the finding isn't in the file yet; otherwise keeps everything else about the
 * row, including any note.
 */
export function setVerdict(row: LabelRow, verdict: Verdict | "", file = LABELS_FILE): Promise<void> {
  return serialized(async () => {
    const rows = await readLabels(file);
    const key = labelKey(row);
    const i = rows.findIndex((r) => labelKey(r) === key);
    if (i >= 0) rows[i] = { ...rows[i], verdict };
    else rows.push({ ...row, verdict });
    await writeLabels(rows, file);
  });
}

export interface MergeResult {
  rows: LabelRow[];
  /** Judged rows outside this worksheet that were kept rather than dropped. */
  keptOutside: number;
}

/**
 * Write a freshly generated worksheet without losing any judgement: rows that
 * were already judged keep their verdict and note, and judged rows the new
 * worksheet doesn't include are carried over at the end.
 */
export function mergeWorksheet(generated: LabelRow[], file = LABELS_FILE): Promise<MergeResult> {
  return serialized(async () => {
    const existing = await readLabels(file);
    const byKey = new Map(existing.map((r) => [labelKey(r), r]));
    const generatedKeys = new Set(generated.map(labelKey));

    const rows = generated.map((g) => {
      const prior = byKey.get(labelKey(g));
      return prior ? { ...g, verdict: prior.verdict, ...(prior.note ? { note: prior.note } : {}) } : g;
    });
    const carried = existing.filter((r) => r.verdict && !generatedKeys.has(labelKey(r)));
    rows.push(...carried);

    await writeLabels(rows, file);
    return { rows, keptOutside: carried.length };
  });
}
