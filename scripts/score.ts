import { isVerdict, readLabels, type LabelRow } from "../src/lib/labels/labelStore";

/**
 * Score rule precision from labels.json — verdicts entered on the match pages
 * or in the worksheet from `npm run label`.
 *
 * Precision = true positives / (true positives + false positives).
 * "unsure" rows are excluded from the denominator rather than guessed at.
 *
 *   npm run score
 */

async function main() {
  const rows = await readLabels();
  if (rows.length === 0) {
    console.log(
      `No labels yet. Judge findings with the Right / Wrong / Can't tell buttons on a match page\n` +
        `(npm run dev), or run: npm run label -- "gameName#tagLine"`,
    );
    return;
  }

  const labeled: LabelRow[] = rows.filter((r) => isVerdict(r.verdict));
  if (labeled.length === 0) {
    console.log(
      `${rows.length} rows found but none judged yet.\n` +
        `Use the buttons on a match page, or set "verdict" to "tp", "fp", or "unsure" in labels.json.`,
    );
    return;
  }

  const byRule = new Map<string, LabelRow[]>();
  for (const r of labeled) {
    const list = byRule.get(r.ruleId) ?? [];
    list.push(r);
    byRule.set(r.ruleId, list);
  }

  console.log(`\nRule precision — ${labeled.length} of ${rows.length} findings labeled\n`);
  console.log(
    `${"rule".padEnd(26)}${"tp".padStart(5)}${"fp".padStart(5)}${"unsure".padStart(8)}${"precision".padStart(12)}`,
  );
  console.log("-".repeat(56));

  let allTp = 0;
  let allFp = 0;
  for (const [ruleId, list] of byRule) {
    const tp = list.filter((r) => r.verdict === "tp").length;
    const fp = list.filter((r) => r.verdict === "fp").length;
    const unsure = list.filter((r) => r.verdict === "unsure").length;
    allTp += tp;
    allFp += fp;
    const p = tp + fp > 0 ? ((tp / (tp + fp)) * 100).toFixed(1) + "%" : "n/a";
    console.log(
      ruleId.padEnd(26) + String(tp).padStart(5) + String(fp).padStart(5) +
        String(unsure).padStart(8) + p.padStart(12),
    );
  }

  console.log("-".repeat(56));
  const overall = allTp + allFp > 0 ? ((allTp / (allTp + allFp)) * 100).toFixed(1) + "%" : "n/a";
  console.log("OVERALL".padEnd(26) + String(allTp).padStart(5) + String(allFp).padStart(5) + "".padStart(8) + overall.padStart(12));

  const fpRate = allTp + allFp > 0 ? ((allFp / (allTp + allFp)) * 100).toFixed(1) : "n/a";
  console.log(`\nFalse-positive rate: ${fpRate}%  (n=${allTp + allFp} judged findings)`);
  if (allTp + allFp < 30) {
    console.log(`Note: fewer than 30 judged findings — treat this as provisional.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
