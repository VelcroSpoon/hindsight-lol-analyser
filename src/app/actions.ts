"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchPlayerGames } from "@/lib/analysis/playerGames";
import { canSaveLabels, isVerdict, setVerdict } from "@/lib/labels/labelStore";
import { labelRowForKey } from "@/lib/report/playerReport";
import { parseRiotId, riotIdToSlug } from "@/lib/report/riotId";

/** How many real games the pages show. */
const GAMES = 20;

export interface OpenPlayerState {
  error?: string;
}

/** Home page form: validate the Riot ID, then go to that player's page. */
export async function openPlayer(_prev: OpenPlayerState, formData: FormData): Promise<OpenPlayerState> {
  const raw = String(formData.get("riotId") ?? "");
  if (!parseRiotId(raw)) {
    return { error: "Enter a Riot ID with its tag, like Name#TAG." };
  }
  redirect(`/player/${riotIdToSlug(raw)}`);
}

export type RefreshState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

/** Turn a Riot client error into what the person should do about it. */
function explain(err: unknown, riotId: string): string {
  const text = err instanceof Error ? err.message : String(err);
  if (text.includes("RIOT_API_KEY is not set")) {
    return "No Riot API key is set. Add RIOT_API_KEY to .env.local, then try again.";
  }
  if (/failed: 40[13]\b/.test(text)) {
    return "Riot rejected the API key. Development keys expire after 24 hours: generate a new one at developer.riotgames.com, paste it into .env.local, then try again.";
  }
  if (/failed: 404\b/.test(text)) {
    return `Riot has no account named ${riotId}. Check the spelling and the tag after the #.`;
  }
  if (/failed: 429\b/.test(text)) {
    return "Riot's rate limit was reached. Wait two minutes, then try again.";
  }
  return `Couldn't get games from Riot: ${text.split("\n")[0]}`;
}

export type SaveVerdictResult = { ok: true } | { ok: false; message: string };

/**
 * Record a person's answer on one finding: "tp" (right), "fp" (wrong),
 * "unsure" (can't tell), or "" to clear it. Only saves against a finding the
 * rules really produce for this player's cached game.
 */
export async function saveVerdict(input: {
  riotId: string;
  matchId: string;
  key: string;
  verdict: string;
}): Promise<SaveVerdictResult> {
  const { riotId, matchId, key, verdict } = input;
  // The page hides the buttons here, but actions can be called directly.
  if (!(await canSaveLabels())) {
    return { ok: false, message: "Answers are only saved when Hindsight runs on your own computer." };
  }
  if (verdict !== "" && !isVerdict(verdict)) {
    return { ok: false, message: "That answer isn't one of right, wrong or can't tell." };
  }

  const row = await labelRowForKey(riotId, matchId, key);
  if (!row) {
    return { ok: false, message: "This finding no longer exists for this game, so the answer wasn't saved." };
  }

  try {
    await setVerdict(row, verdict);
  } catch (err) {
    const text = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { ok: false, message: `Couldn't save to labels.json: ${text}` };
  }

  // The player page shows how many findings have been checked.
  revalidatePath("/player/[slug]", "page");
  return { ok: true };
}

/** Ask Riot for the player's latest games and cache any new ones. */
export async function refreshGames(
  riotId: string,
  _prev: RefreshState,
  _formData: FormData,
): Promise<RefreshState> {
  if (!parseRiotId(riotId)) return { status: "error", message: "That isn't a valid Riot ID." };

  try {
    const result = await fetchPlayerGames(riotId, GAMES);
    revalidatePath("/player/[slug]", "layout");
    return {
      status: "done",
      message:
        result.fetched === 0
          ? "Up to date: no new ranked games since the last check."
          : `Downloaded ${result.fetched} new game${result.fetched === 1 ? "" : "s"}.`,
    };
  } catch (err) {
    return { status: "error", message: explain(err, riotId) };
  }
}
