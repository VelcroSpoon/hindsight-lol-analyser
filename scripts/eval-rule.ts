import "./loadEnv";
import { getCachedAccount } from "../src/lib/cache/accountCache";
import { readCachedTimeline } from "../src/lib/cache/timelineCache";
import { participantIdForPuuid } from "../src/lib/rules/engine";
import { isRemake } from "../src/lib/timeline/gameInfo";
import {
  classifyDeaths,
  VISION_VERSIONS,
  type VisionOptions,
} from "../src/lib/rules/rules/deathsWithoutVision";

/**
 * Accountability report for deaths-without-vision: for every death of the
 * player, what did the rule decide? Runs the rule's own code (classifyDeaths),
 * once per version, over the same games, so the comparison is like-for-like:
 *
 *   flagged    — a finding: no friendly ward confidently nearby.
 *   covered    — a ward was confidently near: a real negative.
 *   abstained  — the ward positions were too uncertain to judge, so the rule
 *                chose silence over a guess.
 *
 *   npm run eval:rule -- "gameName#tagLine"
 */

const VERSIONS: { name: keyof typeof VISION_VERSIONS; note: string }[] = [
  { name: "naive", note: "frames only, every ward trusted (first version)" },
  { name: "worst-case", note: "event anchors, gated on a movement-speed bound" },
  { name: "calibrated", note: "event anchors, gated on measured error (current)" },
];

async function main() {
  const riotId = process.argv[2];
  if (!riotId) throw new Error(`Pass a Riot ID: npm run eval:rule -- "gameName#tagLine"`);
  const account = await getCachedAccount(riotId);
  if (!account) throw new Error(`${riotId} not in account cache.`);

  const tally = new Map<string, { flagged: number; covered: number; abstained: number }>();
  for (const v of VERSIONS) tally.set(v.name, { flagged: 0, covered: 0, abstained: 0 });

  let games = 0;
  let remakes = 0;
  let deaths = 0;

  for (const matchId of account.matchIds) {
    const timeline = await readCachedTimeline(matchId);
    if (!timeline) continue;
    if (isRemake(timeline)) {
      remakes++;
      continue;
    }
    const participantId = participantIdForPuuid(timeline, account.puuid);
    if (participantId === null) continue;
    games++;

    const ctx = { timeline, participantId, puuid: account.puuid };
    for (const v of VERSIONS) {
      const decisions = classifyDeaths(ctx, VISION_VERSIONS[v.name] as VisionOptions);
      if (v.name === "calibrated") deaths += decisions.length;
      const t = tally.get(v.name)!;
      for (const d of decisions) t[d.verdict]++;
    }
  }

  const cell = (n: number) => `${String(n).padStart(4)} ${((n / deaths) * 100).toFixed(1).padStart(5)}%`;

  console.log();
  console.log(`deaths-without-vision — decision breakdown for ${riotId}`);
  console.log(`Matches: ${games} (${remakes} remakes excluded)   Deaths: ${deaths}`);
  console.log();
  console.log(`${"version".padEnd(12)}${"flagged".padStart(12)}${"covered".padStart(13)}${"abstained".padStart(13)}`);
  console.log("-".repeat(50));
  for (const v of VERSIONS) {
    const t = tally.get(v.name)!;
    console.log(`${v.name.padEnd(12)}${cell(t.flagged).padStart(12)}${cell(t.covered).padStart(13)}${cell(t.abstained).padStart(13)}`);
  }
  console.log();
  for (const v of VERSIONS) console.log(`  ${v.name.padEnd(11)} ${v.note}`);
  console.log();
  console.log(
    "Abstaining is the cost of the missing ward coordinates: the naive version\n" +
      "would have flagged those deaths on a guess.",
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
