import type { MatchTimelineDto } from "../riot/types";

/**
 * Recover which champion each participant played, from the timeline alone.
 *
 * The timeline has no "champion per participant" field (the Match-V5 *match*
 * endpoint does, but that needs a live API key). CHAMPION_KILL events do carry
 * per-hit damage breakdowns with champion names, though:
 *
 *   victimDamageReceived[i] = { name: <attacker champion>, participantId: <attacker> }
 *   victimDamageDealt[i]    = { name: <victim's champion>, ... }   (victim is the dealer)
 *
 * These are noisy — pets, transforms and odd attributions put the wrong name
 * against a participant a few percent of the time — so we take a MAJORITY VOTE
 * per participant. Checked against 16 real games: every game resolved to 10
 * distinct champions (as ranked draft guarantees), and the closest vote was
 * 70 to 19.
 *
 * Participants who never dealt or took damage around a kill (e.g. in a remake)
 * are simply absent from the map; callers fall back to "participant N".
 */
export function championNames(timeline: MatchTimelineDto): Map<number, string> {
  const votes = new Map<number, Map<string, number>>();
  const vote = (pid: number | undefined, name: unknown) => {
    if (typeof pid !== "number" || pid < 1 || pid > 10) return;
    if (typeof name !== "string" || name === "") return;
    const tally = votes.get(pid) ?? new Map<string, number>();
    tally.set(name, (tally.get(name) ?? 0) + 1);
    votes.set(pid, tally);
  };

  for (const frame of timeline.info.frames) {
    for (const ev of frame.events ?? []) {
      if (ev.type !== "CHAMPION_KILL") continue;
      const e = ev as {
        victimId?: number;
        victimDamageReceived?: { name?: string; participantId?: number; type?: string }[];
        victimDamageDealt?: { name?: string }[];
      };
      // Only champion sources ("OTHER"); skip MINION / MONSTER / TOWER hits.
      for (const d of e.victimDamageReceived ?? []) {
        if (d.type === "OTHER") vote(d.participantId, d.name);
      }
      for (const d of e.victimDamageDealt ?? []) vote(e.victimId, d.name);
    }
  }

  const result = new Map<number, string>();
  for (const [pid, tally] of votes) {
    let best = "";
    let bestCount = -1;
    for (const [name, count] of tally) {
      if (count > bestCount) {
        best = name;
        bestCount = count;
      }
    }
    result.set(pid, best);
  }
  return result;
}

/** Internal champion ids whose display name can't be derived by splitting camelCase. */
const DISPLAY_OVERRIDES: Record<string, string> = {
  MonkeyKing: "Wukong",
  DrMundo: "Dr. Mundo",
  JarvanIV: "Jarvan IV",
  Nunu: "Nunu & Willump",
  Chogath: "Cho'Gath",
  Kaisa: "Kai'Sa",
  Khazix: "Kha'Zix",
  KogMaw: "Kog'Maw",
  Leblanc: "LeBlanc",
  RekSai: "Rek'Sai",
  Velkoz: "Vel'Koz",
  Belveth: "Bel'Veth",
  KSante: "K'Sante",
  Renata: "Renata Glasc",
  FiddleSticks: "Fiddlesticks",
};

/** "MasterYi" -> "Master Yi", "MonkeyKing" -> "Wukong". */
export function displayChampionName(internal: string): string {
  return DISPLAY_OVERRIDES[internal] ?? internal.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** participantIds 1–5 are blue side (team 100); 6–10 are red side (team 200). */
export function sideOf(participantId: number): "blue" | "red" {
  return participantId <= 5 ? "blue" : "red";
}

/**
 * Human label for a participant: "Master Yi (blue)", or "participant 7 (red)"
 * when the champion couldn't be recovered. killerId 0 means no champion got
 * the kill (tower, minion or monster execute).
 */
export function describeParticipant(names: Map<number, string>, participantId: number): string {
  if (participantId === 0) return "tower/minion/monster (execute)";
  const name = names.get(participantId);
  const who = name ? displayChampionName(name) : `participant ${participantId}`;
  return `${who} (${sideOf(participantId)})`;
}
