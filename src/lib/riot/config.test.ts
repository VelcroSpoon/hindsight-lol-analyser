import { describe, it, expect } from "vitest";
import { regionForMatchId, regionForPlatform } from "./config";

describe("regionForPlatform", () => {
  it("maps each League server to the region that holds its match history", () => {
    expect(regionForPlatform("na1")).toBe("americas");
    expect(regionForPlatform("euw1")).toBe("europe");
    expect(regionForPlatform("kr")).toBe("asia");
    expect(regionForPlatform("oc1")).toBe("sea");
  });

  it("accepts Riot's casing either way", () => {
    expect(regionForPlatform("EUW1")).toBe("europe");
  });

  it("rejects a platform Riot doesn't have", () => {
    expect(() => regionForPlatform("xx9")).toThrow(/Unknown League platform/);
  });
});

describe("regionForMatchId", () => {
  it("reads the region from the match id's prefix", () => {
    expect(regionForMatchId("NA1_1234567890")).toBe("americas");
    expect(regionForMatchId("EUW1_7012345678")).toBe("europe");
    expect(regionForMatchId("KR_7012345678")).toBe("asia");
  });

  it("rejects something that isn't a match id", () => {
    expect(() => regionForMatchId("1234567890")).toThrow(/Not a match id/);
  });
});
