import type { MatchTimelineDto } from "../riot/types";
import type { Finding } from "./finding";

/**
 * The rule engine is a PURE module: given a cached timeline and which
 * participant we're analyzing, it returns Finding[]. No framework imports, no
 * I/O, no network — it runs the same from a Next route or a plain Node script.
 *
 * Rules are self-contained. Each implements the `Rule` interface and is added
 * to the registry (see registry.ts). Adding a new rule never requires editing
 * an existing one.
 */

/** Everything a rule needs to do its job, resolved once and passed to all rules. */
export interface RuleContext {
  timeline: MatchTimelineDto;
  /** participantId (1–10) of the player being analyzed. */
  participantId: number;
  /** PUUID of the player being analyzed. */
  puuid: string;
}

export interface Rule {
  /** Stable id, kebab-case. Also used as Finding.ruleId. */
  id: string;
  /** One-line description of what this rule looks for. */
  description: string;
  /** Pure: inspect the context, return zero or more findings. */
  evaluate(ctx: RuleContext): Finding[];
}

/**
 * Resolve a PUUID to its participantId within a timeline.
 * Returns null if the PUUID isn't in this match.
 */
export function participantIdForPuuid(
  timeline: MatchTimelineDto,
  puuid: string,
): number | null {
  // metadata.participants is indexed such that index i => participantId i+1.
  const idx = timeline.metadata.participants.indexOf(puuid);
  if (idx >= 0) return idx + 1;

  // Fallback: info.participants carries the mapping explicitly.
  const p = timeline.info.participants.find((x) => x.puuid === puuid);
  return p ? p.participantId : null;
}

/**
 * Run a set of rules against one timeline for one player.
 * Findings are returned sorted by in-game time.
 */
export function runRules(
  rules: Rule[],
  timeline: MatchTimelineDto,
  puuid: string,
): Finding[] {
  const participantId = participantIdForPuuid(timeline, puuid);
  if (participantId === null) {
    throw new Error(
      `PUUID ${puuid} is not a participant in match ${timeline.metadata.matchId}.`,
    );
  }

  const ctx: RuleContext = { timeline, participantId, puuid };
  const findings: Finding[] = [];
  for (const rule of rules) {
    findings.push(...rule.evaluate(ctx));
  }
  return findings.sort((a, b) => a.gameTimeMs - b.gameTimeMs);
}
