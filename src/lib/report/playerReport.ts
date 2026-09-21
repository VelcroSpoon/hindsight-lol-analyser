import { loadCachedPlayerGames } from "../analysis/playerGames";
import {
  labelKey,
  labelRowsFor,
  readLabels,
  type LabelRow,
  type Verdict as LabelVerdict,
} from "../labels/labelStore";
import { getCachedAccount } from "../cache/accountCache";
import { readCachedTimeline } from "../cache/timelineCache";
import { participantIdForPuuid, runRules } from "../rules/engine";
import { rules } from "../rules/registry";
import type { Finding } from "../rules/finding";
import { classifyDeaths } from "../rules/rules/deathsWithoutVision";
import type { MatchTimelineDto } from "../riot/types";
import { championNames, describeParticipant, displayChampionName, sideOf } from "../timeline/champions";
import { didWin, gameDurationMs, gameEndEvent, isRemake } from "../timeline/gameInfo";

/**
 * Everything the web pages show, assembled from the cache. Server-side only
 * (reads the filesystem). Every value returned is plain JSON so it can be
 * passed straight into client components.
 */

export type Verdict = "flagged" | "covered" | "abstained";

export interface DeathPoint {
  /** Game clock of the death, ms. Also the id used to link map and findings. */
  t: number;
  x: number;
  y: number;
  verdict: Verdict;
}

export interface GameSummary {
  matchId: string;
  /** When the game ended, epoch ms. */
  playedAt: number | null;
  durationMs: number;
  champion: string;
  side: "blue" | "red";
  result: "win" | "loss" | "unknown";
  findings: Finding[];
  deaths: DeathPoint[];
}

export interface HandCheckStatus {
  /** Findings from this player's games written to labels.json. */
  rows: number;
  tp: number;
  fp: number;
  unsure: number;
  /** Findings with any answer (right, wrong or can't tell), per match. */
  judgedByMatch: Record<string, number>;
}

export interface PlayerReport {
  riotId: string;
  games: GameSummary[];
  wanted: number;
  remakesSkipped: number;
  cachedMatchIds: number;
  /** The vision rule's decision on every death across these games. */
  vision: { deaths: number; flagged: number; covered: number; abstained: number };
  handCheck: HandCheckStatus;
}

export interface WardView {
  x: number;
  y: number;
  /** Expected error on the estimated position, game units. */
  uncertainty: number;
  confident: boolean;
  placedAt: number;
}

export interface DeathView extends DeathPoint {
  killedBy: string;
  assists: string[];
  /** Distance to the nearest trusted ward, game units; null if none was trusted. */
  nearest: number | null;
  /** Friendly wards live at the moment of death, as the rule saw them. */
  wards: WardView[];
}

export interface FindingLabel {
  /** Identifies the finding in labels.json (see labelKey). */
  key: string;
  /** The person's answer: tp (right), fp (wrong), unsure, or "" if not judged. */
  verdict: LabelVerdict | "";
}

export interface MatchView extends Omit<GameSummary, "deaths"> {
  riotId: string;
  deaths: DeathView[];
  /** One per finding, same order as `findings`. */
  findingLabels: FindingLabel[];
  /** Set when labels.json exists but can't be read; judging is then disabled. */
  labelsError: string | null;
}

function summarize(matchId: string, timeline: MatchTimelineDto, puuid: string) {
  const participantId = participantIdForPuuid(timeline, puuid);
  if (participantId === null) return null;

  const names = championNames(timeline);
  const internal = names.get(participantId);
  const win = didWin(timeline, participantId);
  const decisions = classifyDeaths({ timeline, participantId, puuid });

  const summary: GameSummary = {
    matchId,
    playedAt: gameEndEvent(timeline)?.realTimestamp ?? null,
    durationMs: gameDurationMs(timeline),
    champion: internal ? displayChampionName(internal) : "Unknown champion",
    side: sideOf(participantId),
    result: win === null ? "unknown" : win ? "win" : "loss",
    findings: runRules(rules, timeline, puuid),
    deaths: decisions.map((d) => ({
      t: d.kill.timestamp,
      x: d.kill.position.x,
      y: d.kill.position.y,
      verdict: d.verdict,
    })),
  };
  return { summary, decisions, names };
}

async function handCheckStatus(matchIds: Set<string>): Promise<HandCheckStatus> {
  const status: HandCheckStatus = { rows: 0, tp: 0, fp: 0, unsure: 0, judgedByMatch: {} };
  let rows: LabelRow[];
  try {
    rows = await readLabels();
  } catch {
    return status; // unreadable file: the match page reports it where judging happens
  }
  for (const r of rows) {
    if (!matchIds.has(r.matchId)) continue;
    status.rows++;
    if (r.verdict === "tp") status.tp++;
    else if (r.verdict === "fp") status.fp++;
    else if (r.verdict === "unsure") status.unsure++;
    if (r.verdict) status.judgedByMatch[r.matchId] = (status.judgedByMatch[r.matchId] ?? 0) + 1;
  }
  return status;
}

/** The player's N most recent real games, from the cache. Null if never fetched. */
export async function loadPlayerReport(riotId: string, wanted = 20): Promise<PlayerReport | null> {
  const loaded = await loadCachedPlayerGames(riotId, wanted);
  if (!loaded) return null;

  const games: GameSummary[] = [];
  const vision = { deaths: 0, flagged: 0, covered: 0, abstained: 0 };
  for (const { matchId, timeline } of loaded.games) {
    const s = summarize(matchId, timeline, loaded.puuid);
    if (!s) continue;
    games.push(s.summary);
    for (const d of s.summary.deaths) {
      vision.deaths++;
      vision[d.verdict]++;
    }
  }

  return {
    riotId: loaded.riotId,
    games,
    wanted,
    remakesSkipped: loaded.entries.filter((e) => e.kind === "remake").length,
    cachedMatchIds: loaded.cachedMatchIds,
    vision,
    handCheck: await handCheckStatus(new Set(games.map((g) => g.matchId))),
  };
}

/** One game in full detail. Null unless the match belongs to this cached player. */
export async function loadMatchView(riotId: string, matchId: string): Promise<MatchView | null> {
  const account = await getCachedAccount(riotId);
  if (!account || !account.matchIds.includes(matchId)) return null;
  const timeline = await readCachedTimeline(matchId);
  if (!timeline || isRemake(timeline)) return null;

  const s = summarize(matchId, timeline, account.puuid);
  if (!s) return null;

  const deaths: DeathView[] = s.decisions.map((d) => ({
    t: d.kill.timestamp,
    x: d.kill.position.x,
    y: d.kill.position.y,
    verdict: d.verdict,
    killedBy: describeParticipant(s.names, d.kill.killerId ?? 0),
    assists: (d.kill.assistingParticipantIds ?? []).map((id) => describeParticipant(s.names, id)),
    nearest: d.verdict === "abstained" || !Number.isFinite(d.nearest) ? null : d.nearest,
    wards: d.wards.map((w) => ({
      x: w.pos.x,
      y: w.pos.y,
      uncertainty: w.uncertainty,
      confident: w.confident,
      placedAt: w.placedAt,
    })),
  }));

  // Saved verdicts for this game's findings.
  const rows = labelRowsFor(matchId, timeline, account.puuid, s.summary.findings);
  let saved = new Map<string, LabelVerdict | "">();
  let labelsError: string | null = null;
  try {
    saved = new Map((await readLabels()).map((r) => [labelKey(r), r.verdict]));
  } catch (err) {
    labelsError = `labels.json can't be read (${err instanceof Error ? err.message : err}). Fix or move the file to judge findings.`;
  }
  const findingLabels = rows.map((r) => ({ key: labelKey(r), verdict: saved.get(labelKey(r)) ?? "" }));

  return { ...s.summary, riotId: account.riotId, deaths, findingLabels, labelsError };
}

/**
 * The worksheet row for one finding of a cached game, identified by its label
 * key. Null if there's no such finding — the only way a verdict gets saved is
 * against a finding the rules actually produce for this player and game.
 */
export async function labelRowForKey(riotId: string, matchId: string, key: string): Promise<LabelRow | null> {
  const account = await getCachedAccount(riotId);
  if (!account || !account.matchIds.includes(matchId)) return null;
  const timeline = await readCachedTimeline(matchId);
  if (!timeline) return null;
  const findings = runRules(rules, timeline, account.puuid);
  return labelRowsFor(matchId, timeline, account.puuid, findings).find((r) => labelKey(r) === key) ?? null;
}
