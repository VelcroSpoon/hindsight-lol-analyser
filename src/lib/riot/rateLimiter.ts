/**
 * A tiny sliding-window rate limiter that can enforce several windows at once
 * (Riot dev keys are limited on two: ~20 req/s and 100 req/2 min).
 *
 * Acquisitions are serialized through a promise chain so that concurrent
 * callers can't race past a window boundary. This is deliberately conservative
 * — for a dev key doing a handful of requests it's plenty, and it guarantees we
 * never trip the limit rather than optimizing for maximum throughput.
 */

export interface RateWindow {
  /** Max requests permitted within the interval. */
  limit: number;
  /** Interval length in milliseconds. */
  intervalMs: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class RateLimiter {
  private readonly windows: (RateWindow & { hits: number[] })[];
  private chain: Promise<void> = Promise.resolve();

  constructor(windows: RateWindow[]) {
    this.windows = windows.map((w) => ({ ...w, hits: [] }));
  }

  /** Wait until a request slot is free in every window, then reserve it. */
  async acquire(): Promise<void> {
    const next = this.chain.then(() => this.reserve());
    // Keep the chain alive even if a reservation somehow rejects.
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async reserve(): Promise<void> {
    for (;;) {
      const now = Date.now();
      let waitMs = 0;

      for (const w of this.windows) {
        // Drop timestamps that have aged out of this window.
        w.hits = w.hits.filter((t) => now - t < w.intervalMs);
        if (w.hits.length >= w.limit) {
          const oldest = w.hits[0];
          waitMs = Math.max(waitMs, w.intervalMs - (now - oldest));
        }
      }

      if (waitMs <= 0) {
        const stamp = Date.now();
        for (const w of this.windows) w.hits.push(stamp);
        return;
      }

      // Small cushion so we wake up just after the window frees a slot.
      await sleep(waitMs + 10);
    }
  }
}

/**
 * Shared limiter for all Riot requests, sized a touch under the dev-key
 * ceilings (18/s and 95/2min) to leave headroom for clock jitter.
 */
export const riotRateLimiter = new RateLimiter([
  { limit: 18, intervalMs: 1_000 },
  { limit: 95, intervalMs: 120_000 },
]);
