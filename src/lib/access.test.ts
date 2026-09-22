import { describe, it, expect } from "vitest";
import { accessToken, safeNextPath, sameString } from "./access";

describe("accessToken", () => {
  it("is stable for the same password and differs for another", async () => {
    expect(await accessToken("hunter2")).toBe(await accessToken("hunter2"));
    expect(await accessToken("hunter2")).not.toBe(await accessToken("hunter3"));
  });

  it("never contains the password itself", async () => {
    const token = await accessToken("correct horse");
    expect(token).not.toContain("correct");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sameString", () => {
  it("matches equal strings only", () => {
    expect(sameString("abc", "abc")).toBe(true);
    expect(sameString("abc", "abd")).toBe(false);
    expect(sameString("abc", "abcd")).toBe(false);
    expect(sameString("", "")).toBe(true);
  });
});

describe("safeNextPath", () => {
  it("keeps paths on this site", () => {
    expect(safeNextPath("/player/PlayerName-NA1?t=5")).toBe("/player/PlayerName-NA1?t=5");
  });

  it("sends anything off-site to the home page", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath("")).toBe("/");
  });
});
