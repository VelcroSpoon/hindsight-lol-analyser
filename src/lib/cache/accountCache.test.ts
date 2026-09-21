import { describe, it, expect } from "vitest";
import { mergeMatchIds } from "./accountCache";

describe("mergeMatchIds", () => {
  it("unions lists without duplicates, newest first", () => {
    expect(mergeMatchIds(["NA1_5", "NA1_4"], ["NA1_4", "NA1_3", "NA1_2"])).toEqual([
      "NA1_5",
      "NA1_4",
      "NA1_3",
      "NA1_2",
    ]);
  });

  it("never forgets ids a longer earlier run saved", () => {
    const earlier = Array.from({ length: 40 }, (_, i) => `NA1_${1000 - i}`);
    const shorterRun = earlier.slice(0, 20);
    expect(mergeMatchIds(shorterRun, earlier)).toEqual(earlier);
  });

  it("puts newly played games in front of older cached ones", () => {
    expect(mergeMatchIds(["NA1_20", "NA1_19"], ["NA1_10", "NA1_9"])).toEqual([
      "NA1_20",
      "NA1_19",
      "NA1_10",
      "NA1_9",
    ]);
  });
});
