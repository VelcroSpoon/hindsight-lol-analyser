import { describe, it, expect } from "vitest";
import { parseRiotId, riotIdToSlug, slugToRiotId } from "./riotId";

describe("parseRiotId", () => {
  it("splits gameName and tagLine", () => {
    expect(parseRiotId("PlayerName#NA1")).toEqual({ gameName: "PlayerName", tagLine: "NA1" });
  });

  it("tolerates surrounding whitespace and spaces in the name", () => {
    expect(parseRiotId("  Big Smurf #EUW ")).toEqual({ gameName: "Big Smurf", tagLine: "EUW" });
  });

  it("rejects input without a usable tag", () => {
    expect(parseRiotId("PlayerName")).toBeNull();
    expect(parseRiotId("PlayerName#")).toBeNull();
    expect(parseRiotId("#NA1")).toBeNull();
  });
});

describe("slugs", () => {
  it("round-trips a Riot ID through a URL slug", () => {
    expect(riotIdToSlug("PlayerName#NA1")).toBe("PlayerName-NA1");
    expect(slugToRiotId("PlayerName-NA1")).toBe("PlayerName#NA1");
  });

  it("keeps hyphens and spaces inside the game name", () => {
    const slug = riotIdToSlug("Mid-or Feed#NA1");
    expect(slugToRiotId(slug)).toBe("Mid-or Feed#NA1");
  });

  it("rejects malformed slugs", () => {
    expect(slugToRiotId("PlayerName")).toBeNull();
    expect(slugToRiotId("PlayerName-")).toBeNull();
    expect(slugToRiotId("%E0%A4%A")).toBeNull(); // broken percent-encoding
  });
});
