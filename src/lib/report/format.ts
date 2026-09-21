/** Display formatting shared by the pages. Pure. */

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export function formatPlayedAt(epochMs: number | null): string {
  return epochMs === null ? "Unknown date" : dateFormat.format(new Date(epochMs));
}

/** 2764000 -> "46 min" */
export function formatLength(ms: number): string {
  return `${Math.round(ms / 60_000)} min`;
}

/** 1787318 -> "29:47" */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** "3 deaths", "1 death" */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
