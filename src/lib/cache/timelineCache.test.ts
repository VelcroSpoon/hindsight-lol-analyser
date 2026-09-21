import { describe, it, expect } from "vitest";
import { TIMELINE_FILE } from "./timelineCache";

/**
 * /cache holds more than timelines (accounts.json today, maybe more later), and
 * the eval scripts scan it for timelines. This pattern is the only thing keeping
 * them from parsing the wrong files, so pin it down.
 */
describe("TIMELINE_FILE", () => {
  it("matches cached timeline filenames", () => {
    expect(TIMELINE_FILE.test("NA1_1234567890.json")).toBe(true);
    expect(TIMELINE_FILE.test("EUW1_7012345678.json")).toBe(true);
  });

  it("rejects everything else that lives in /cache", () => {
    expect(TIMELINE_FILE.test("accounts.json")).toBe(false);
    expect(TIMELINE_FILE.test("labels.json")).toBe(false);
    // In-flight atomic write from writeCachedTimeline.
    expect(TIMELINE_FILE.test("NA1_1234567890.json.4242.tmp")).toBe(false);
  });
});
