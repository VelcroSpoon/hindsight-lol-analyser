/**
 * Riot IDs in URLs and forms. Pure.
 *
 * A Riot ID is "gameName#tagLine". "#" can't sit in a URL path, so pages use
 * "gameName-tagLine" (the convention sites like op.gg use). Tag lines never
 * contain "-", so the LAST "-" is always the separator even when the game name
 * has one.
 */

/** Parse user input like "PlayerName#NA1" (whitespace tolerated). Null if malformed. */
export function parseRiotId(input: string): { gameName: string; tagLine: string } | null {
  const trimmed = input.trim();
  const hash = trimmed.lastIndexOf("#");
  if (hash <= 0 || hash === trimmed.length - 1) return null;
  const gameName = trimmed.slice(0, hash).trim();
  const tagLine = trimmed.slice(hash + 1).trim();
  if (!gameName || !tagLine || /[#-]/.test(tagLine)) return null;
  return { gameName, tagLine };
}

/** "PlayerName#NA1" -> "PlayerName-NA1" (URL-encoded, so names with spaces survive). */
export function riotIdToSlug(riotId: string): string {
  const parsed = parseRiotId(riotId);
  if (!parsed) throw new Error(`Not a Riot ID: "${riotId}"`);
  return encodeURIComponent(`${parsed.gameName}-${parsed.tagLine}`);
}

/** "PlayerName-NA1" -> "PlayerName#NA1". Accepts encoded or decoded slugs. Null if malformed. */
export function slugToRiotId(slug: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const dash = decoded.lastIndexOf("-");
  if (dash <= 0 || dash === decoded.length - 1) return null;
  const riotId = `${decoded.slice(0, dash)}#${decoded.slice(dash + 1)}`;
  return parseRiotId(riotId) ? riotId : null;
}
