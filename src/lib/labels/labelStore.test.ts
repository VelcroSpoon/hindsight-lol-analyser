import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  labelKey,
  labelRowsFor,
  mergeWorksheet,
  readLabels,
  setVerdict,
  type LabelRow,
} from "./labelStore";
import { buildTimeline, puuidFor } from "../testing/fixtures";
import type { Finding } from "../rules/finding";

/**
 * labels.json holds hand-collected answers, which are expensive to redo. These
 * tests pin down the one promise that matters: nothing a person judged is lost,
 * whichever tool writes the file.
 */

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "hindsight-labels-"));
  file = path.join(dir, "labels.json");
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const row = (gameTimeMs: number, extra: Partial<LabelRow> = {}): LabelRow => ({
  matchId: "NA1_1",
  gameTime: "0:00",
  you: "Mel (red)",
  ruleId: "deaths-without-vision",
  title: "Death without vision",
  detail: "detail",
  gameTimeMs,
  verdict: "",
  ...extra,
});

describe("labelRowsFor", () => {
  const finding = (title: string): Finding => ({
    ruleId: "lane-differential",
    severity: 2,
    gameTimeMs: 600_000,
    title,
    detail: "",
  });

  it("gives two findings from one rule at the same moment different keys", () => {
    // The lane rule can report a gold AND an XP deficit at 10:00.
    const rows = labelRowsFor("NA1_1", buildTimeline(), puuidFor(2), [
      finding("Down 900 gold at 10 min"),
      finding("Down 1,200 XP at 10 min"),
    ]);
    expect(rows).toHaveLength(2);
    expect(labelKey(rows[0])).not.toBe(labelKey(rows[1]));
    expect(rows[0].occurrence).toBeUndefined(); // the usual case keeps the old key
    expect(rows[1].occurrence).toBe(1);
  });

  it("keeps the two verdicts separate when both are judged", async () => {
    const [gold, xp] = labelRowsFor("NA1_1", buildTimeline(), puuidFor(2), [
      finding("Down 900 gold at 10 min"),
      finding("Down 1,200 XP at 10 min"),
    ]);
    await setVerdict(gold, "tp", file);
    await setVerdict(xp, "fp", file);
    const rows = await readLabels(file);
    expect(rows.map((r) => r.verdict)).toEqual(["tp", "fp"]);
  });
});

describe("setVerdict", () => {
  it("creates the file and the row when neither exists", async () => {
    await setVerdict(row(1000), "tp", file);
    const rows = await readLabels(file);
    expect(rows).toHaveLength(1);
    expect(rows[0].verdict).toBe("tp");
  });

  it("updates an existing row in place and keeps its note", async () => {
    await fs.writeFile(file, JSON.stringify([row(1000, { note: "control ward in bush" })]));
    await setVerdict(row(1000), "fp", file);
    const rows = await readLabels(file);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "fp", note: "control ward in bush" });
  });

  it("clears a verdict with an empty string", async () => {
    await setVerdict(row(1000), "tp", file);
    await setVerdict(row(1000), "", file);
    expect((await readLabels(file))[0].verdict).toBe("");
  });

  it("doesn't lose answers when several are saved at once", async () => {
    await Promise.all([1000, 2000, 3000, 4000, 5000].map((t) => setVerdict(row(t), "tp", file)));
    const rows = await readLabels(file);
    expect(rows.map((r) => r.gameTimeMs).sort()).toEqual([1000, 2000, 3000, 4000, 5000]);
  });

  it("refuses to overwrite a file it can't parse", async () => {
    await fs.writeFile(file, "{ not json");
    await expect(setVerdict(row(1000), "tp", file)).rejects.toThrow();
    expect(await fs.readFile(file, "utf8")).toBe("{ not json");
  });
});

describe("mergeWorksheet", () => {
  it("keeps verdicts and notes for rows it regenerates", async () => {
    await fs.writeFile(file, JSON.stringify([row(1000, { verdict: "fp", note: "n" })]));
    const { rows } = await mergeWorksheet([row(1000, { detail: "new wording" })], file);
    expect(rows[0]).toMatchObject({ detail: "new wording", verdict: "fp", note: "n" });
  });

  it("carries over judged rows the new worksheet leaves out", async () => {
    await fs.writeFile(
      file,
      JSON.stringify([row(1000, { verdict: "tp" }), row(2000, { ruleId: "died-with-unspent-gold", verdict: "fp" }), row(3000)]),
    );
    const { rows, keptOutside } = await mergeWorksheet([row(1000)], file);
    expect(keptOutside).toBe(1);
    expect(rows.map(labelKey)).toEqual([
      labelKey(row(1000)),
      labelKey(row(2000, { ruleId: "died-with-unspent-gold" })),
    ]);
    // The unjudged row outside the worksheet is dropped: nothing is lost.
    expect(rows.some((r) => r.gameTimeMs === 3000)).toBe(false);
  });
});
