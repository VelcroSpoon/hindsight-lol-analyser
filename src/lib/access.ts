/**
 * Password gate for deployed copies of Hindsight.
 *
 * Riot's personal API keys may not power a project the public can access, so a
 * deployment stays behind a password (SITE_PASSWORD) until a production key is
 * approved. Visitors enter it once; the browser keeps a cookie for a year.
 *
 * Runs in the middleware (edge runtime), so Web APIs only — no node: imports.
 */

export const ACCESS_COOKIE = "hindsight_access";

/** How long a successful login lasts. */
export const ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * The cookie value for a password: a SHA-256 hash, so the password itself is
 * never stored in the browser. Changing SITE_PASSWORD signs everyone out.
 */
export async function accessToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`hindsight-access:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare two strings in time that doesn't depend on where they differ. */
export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Where to send someone after logging in. Only paths on this site: anything
 * else (another domain, "//evil.com") goes to the home page.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
