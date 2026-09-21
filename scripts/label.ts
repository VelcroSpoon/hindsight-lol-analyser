import "./loadEnv";
import { getCachedAccount } from "../src/lib/cache/accountCache";
import { readCachedTimeline } from "../src/lib/cache/timelineCache";
import { runRules } from "../src/lib/rules/engine";
import { rules } from "../src/lib/rules/registry";
import { isRemake } from "../src/lib/timeline/gameInfo";
import { LABELS_FILE, labelRowsFor, mergeWorksheet, type LabelRow } from "../src/lib/labels/labelStore";

/**
 * Build a hand-labeling worksheet for measuring rule PRECISION.
 *
 * There is no machine oracle for "was this finding actually correct" — that
 * judgement needs a human watching the replay. The easiest way to judge is the
 * Right / Wrong / Can't tell buttons on each match page (npm run dev). This
 * script is the file-based alternative: it writes every finding as a row with
 * a blank `verdict` you fill in with "tp" (right), "fp" (wrong) or "unsure".
 *
 * Re-running never loses work: judged rows keep their verdict and note, and
 * judged rows outside this selection (e.g. from the match page) are kept too.
 * Then `npm run score` reports precision per rule.
 *
 *   npm run label -- "gameName#tagLine" [--rule <ruleId>] [--limit N]
 */

async function main() {
  const argv = process.argv.slice(2);
  const riotId = argv.find((a) => !a.startsWith("-"));
  if (!riotId) throw new Error(`Pass a Riot ID: npm run label -- "gameName#tagLine"`);
  const ruleFilter = argv.includes("--rule") ? argv[argv.indexOf("--rule") + 1] : null;
  const limit = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) : 50;

  const account = await getCachedAccount(riotId);
  if (!account) throw new Error(`${riotId} is not cached. Run analyze once first.`);

  const active = ruleFilter ? rules.filter((r) => r.id === ruleFilter) : rules;
  if (active.length === 0) throw new Error(`No rule with id "${ruleFilter}".`);

  const generated: LabelRow[] = [];
  for (const matchId of account.matchIds) {
    const timeline = await readCachedTimeline(matchId);
    if (!timeline || isRemake(timeline)) continue;
    const findings = runRules(active, timeline, account.puuid);
    generated.push(...labelRowsFor(matchId, timeline, account.puuid, findings));
    if (generated.length >= limit) break;
  }

  const { rows, keptOutside } = await mergeWorksheet(generated.slice(0, limit));

  const judged = rows.filter((r) => r.verdict).length;
  console.log(`Wrote ${rows.length} rows to ${LABELS_FILE}`);
  console.log(`  judged: ${judged}   waiting: ${rows.length - judged}`);
  if (keptOutside > 0) {
    console.log(`  kept ${keptOutside} judged row(s) from outside this selection`);
  }
  console.log(`\nJudge findings on each match page (npm run dev), or edit labels.json:`);
  console.log(`set each "verdict" to "tp" (right), "fp" (wrong) or "unsure".`);
  console.log(`Then run:  npm run score`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
