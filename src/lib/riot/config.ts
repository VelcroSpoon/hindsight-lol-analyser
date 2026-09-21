/**
 * Central Riot API configuration. Server-side only.
 *
 * We intentionally do NOT use the `server-only` package here: its default
 * export condition throws under plain Node (tsx), which would break the
 * standalone `npm run analyze` script. Instead we assert at module load that
 * we're not in a browser — this still fails loudly if the module is ever
 * pulled into a client bundle, while remaining runnable from a Node script.
 *
 * The API key is read lazily (not at module load) so build-time tooling that
 * imports the client without a key set doesn't crash. It only throws when you
 * actually try to make a request.
 */

if (typeof window !== "undefined") {
  throw new Error(
    "src/lib/riot/config.ts is server-only and must not be imported into client code.",
  );
}

export type RiotRegion = "americas" | "asia" | "europe" | "sea";

const VALID_REGIONS: RiotRegion[] = ["americas", "asia", "europe", "sea"];

export function getApiKey(): string {
  const key = process.env.RIOT_API_KEY;
  if (!key || key.trim() === "" || key.includes("xxxx")) {
    throw new Error(
      "RIOT_API_KEY is not set. Copy .env.local.example to .env.local and add your Riot dev key.",
    );
  }
  return key.trim();
}

export function getRegion(): RiotRegion {
  const region = (process.env.RIOT_REGION ?? "americas").trim().toLowerCase();
  if (!VALID_REGIONS.includes(region as RiotRegion)) {
    throw new Error(
      `RIOT_REGION="${region}" is invalid. Use one of: ${VALID_REGIONS.join(", ")}.`,
    );
  }
  return region as RiotRegion;
}

/** Base URL for a regional-routed endpoint (Account-V1, Match-V5). */
export function regionalBaseUrl(region: RiotRegion = getRegion()): string {
  return `https://${region}.api.riotgames.com`;
}
