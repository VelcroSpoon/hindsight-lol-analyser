import { describe, it, expect } from "vitest";
import { runRules, participantIdForPuuid, type Rule } from "./engine";
import type { Finding } from "./finding";
import { buildTimeline, championKill, puuidFor } from "../testing/fixtures";

/**
 * Engine tests. The engine's contract is: resolve the player, hand every rule
 * the same context, concatenate their findings, return them time-sorted.
 * Crucially, rules must be independent — one rule must not affect another.
 */

const ruleEmitting = (id: string, times: number[]): Rule => ({
  id,
  description: `test rule ${id}`,
  evaluate: (ctx) =>
    times.map(
      (t): Finding => ({
        ruleId: id,
        severity: 1,
        gameTimeMs: t,
        title: `${id}@${t}`,
        detail: `participant ${ctx.participantId}`,
      }),
    ),
});

describe("participantIdForPuuid", () => {
  it("maps a puuid to its participant id", () => {
    const timeline = buildTimeline();
    expect(participantIdForPuuid(timeline, puuidFor(1))).toBe(1);
    expect(participantIdForPuuid(timeline, puuidFor(7))).toBe(7);
  });

  it("returns null for a puuid not in the match", () => {
    expect(participantIdForPuuid(buildTimeline(), "not-in-this-game")).toBeNull();
  });
});

describe("runRules", () => {
  it("throws a clear error when the player isn't in the match", () => {
    expect(() => runRules([], buildTimeline(), "stranger")).toThrow(/not a participant/);
  });

  it("returns an empty array when no rules are registered", () => {
    expect(runRules([], buildTimeline(), puuidFor(1))).toEqual([]);
  });

  it("merges findings from multiple rules, sorted by game time", () => {
    const rules = [ruleEmitting("a", [5000, 1000]), ruleEmitting("b", [3000])];

    const findings = runRules(rules, buildTimeline(), puuidFor(1));

    expect(findings.map((f) => f.gameTimeMs)).toEqual([1000, 3000, 5000]);
    expect(findings.map((f) => f.ruleId)).toEqual(["a", "b", "a"]);
  });

  it("keeps rules independent — adding one does not change another's output", () => {
    const a = ruleEmitting("a", [1000]);
    const b = ruleEmitting("b", [2000]);
    const timeline = buildTimeline();

    const aAlone = runRules([a], timeline, puuidFor(1)).filter((f) => f.ruleId === "a");
    const aWithB = runRules([a, b], timeline, puuidFor(1)).filter((f) => f.ruleId === "a");

    expect(aWithB).toEqual(aAlone);
  });

  it("passes the resolved participantId to rules", () => {
    const findings = runRules([ruleEmitting("a", [0])], buildTimeline(), puuidFor(6));
    expect(findings[0].detail).toBe("participant 6");
  });

  it("does not mutate the input timeline", () => {
    const timeline = buildTimeline({
      events: [championKill({ timestamp: 1000, victimId: 2, position: { x: 1, y: 2 } })],
    });
    const before = JSON.stringify(timeline);

    runRules([ruleEmitting("a", [1000])], timeline, puuidFor(2));

    expect(JSON.stringify(timeline)).toBe(before);
  });
});
