import { describe, it, expect } from "vitest";
import {
  championNames,
  describeParticipant,
  displayChampionName,
  sideOf,
} from "./champions";
import { buildTimeline } from "../testing/fixtures";
import type { TimelineEvent } from "../riot/types";

/** A CHAMPION_KILL with damage breakdowns, shaped like the real Riot payload. */
function killWithDamage(opts: {
  timestamp: number;
  victimId: number;
  victimChampion: string;
  attackers: { participantId: number; name: string; type?: string; hits?: number }[];
}): TimelineEvent {
  const received = opts.attackers.flatMap((a) =>
    Array.from({ length: a.hits ?? 1 }, () => ({
      name: a.name,
      participantId: a.participantId,
      type: a.type ?? "OTHER",
    })),
  );
  return {
    type: "CHAMPION_KILL",
    timestamp: opts.timestamp,
    victimId: opts.victimId,
    killerId: opts.attackers[0]?.participantId ?? 0,
    position: { x: 0, y: 0 },
    victimDamageReceived: received,
    victimDamageDealt: [{ name: opts.victimChampion, participantId: 99, type: "OTHER" }],
  } as TimelineEvent;
}

describe("championNames", () => {
  it("reads attacker names from victimDamageReceived and the victim's from victimDamageDealt", () => {
    const timeline = buildTimeline({
      events: [
        killWithDamage({
          timestamp: 1000,
          victimId: 6,
          victimChampion: "Illaoi",
          attackers: [{ participantId: 2, name: "MasterYi" }],
        }),
      ],
    });
    const names = championNames(timeline);
    expect(names.get(2)).toBe("MasterYi");
    expect(names.get(6)).toBe("Illaoi");
  });

  it("takes the majority when a participant's hits carry stray names", () => {
    const timeline = buildTimeline({
      events: [
        killWithDamage({
          timestamp: 1000,
          victimId: 6,
          victimChampion: "Illaoi",
          attackers: [
            { participantId: 7, name: "MasterYi", hits: 12 },
            { participantId: 7, name: "Briar", hits: 2 }, // noise, like the real data
          ],
        }),
      ],
    });
    expect(championNames(timeline).get(7)).toBe("MasterYi");
  });

  it("ignores minion, monster and tower damage", () => {
    const timeline = buildTimeline({
      events: [
        killWithDamage({
          timestamp: 1000,
          victimId: 6,
          victimChampion: "Illaoi",
          attackers: [{ participantId: 3, name: "SRU_OrderMinionRanged", type: "MINION" }],
        }),
      ],
    });
    expect(championNames(timeline).has(3)).toBe(false);
  });

  it("returns an empty map when there were no kills (e.g. a remake)", () => {
    expect(championNames(buildTimeline()).size).toBe(0);
  });
});

describe("display helpers", () => {
  it("splits camelCase internal ids", () => {
    expect(displayChampionName("MasterYi")).toBe("Master Yi");
    expect(displayChampionName("TahmKench")).toBe("Tahm Kench");
    expect(displayChampionName("Ahri")).toBe("Ahri");
  });

  it("uses the override table for names camelCase can't fix", () => {
    expect(displayChampionName("MonkeyKing")).toBe("Wukong");
    expect(displayChampionName("Kaisa")).toBe("Kai'Sa");
  });

  it("maps participants to sides", () => {
    expect(sideOf(1)).toBe("blue");
    expect(sideOf(5)).toBe("blue");
    expect(sideOf(6)).toBe("red");
  });

  it("describes a participant, falling back when the champion is unknown", () => {
    const names = new Map([[2, "MasterYi"]]);
    expect(describeParticipant(names, 2)).toBe("Master Yi (blue)");
    expect(describeParticipant(names, 8)).toBe("participant 8 (red)");
    expect(describeParticipant(names, 0)).toBe("tower/minion/monster (execute)");
  });
});
