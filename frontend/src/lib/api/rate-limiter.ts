/**
 * Client-side sliding-window rate limiter — queues calls so they never
 * exceed `maxRequests` within any `windowMs` window, instead of firing them
 * all immediately and letting the provider itself reject the overflow with
 * a 429 (which can also lead to a longer, provider-side ban if it keeps
 * happening).
 */
export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  /** Called (each time a caller has to wait) with how long the wait will be. */
  onWait?: (waitMs: number) => void;
}

export class RateLimiter {
  private timestamps: number[] = [];

  constructor(private opts: RateLimiterOptions) {}

  /** Resolves once it's safe to fire the next request, waiting if needed. */
  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.timestamps = this.timestamps.filter(t => now - t < this.opts.windowMs);
      if (this.timestamps.length < this.opts.maxRequests) {
        this.timestamps.push(now);
        return;
      }
      const oldest = this.timestamps[0];
      const waitMs = this.opts.windowMs - (now - oldest) + 25;
      this.opts.onWait?.(waitMs);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
}

function notifyRateLimitWait(provider: string, waitMs: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('metadea:rate-limit-wait', { detail: { provider, waitMs } }));
}

// AniList's own documented limit is 90 requests/min — capped well under that
// (60, not 90) since this queue only covers requests made through
// graphqlPost, and AniList calls elsewhere in the app (media detail pages,
// character/staff bios, the media editor's "import from AniList") aren't
// necessarily funneled through the exact same in-flight moment, so the
// margin absorbs bursts across several open tabs/features at once instead
// of riding the documented ceiling exactly.
export const anilistRateLimiter = new RateLimiter({
  maxRequests: 60,
  windowMs: 60_000,
  onWait: (waitMs) => notifyRateLimitWait('AniList', waitMs),
});
