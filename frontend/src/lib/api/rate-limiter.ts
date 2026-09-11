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

  // Show toast notification to user
  try {
    const message = provider === 'AniList'
      ? (window as any).__i18n?.settings?.anilist_rate_limit || 'You\'ve reached the maximum number of requests for 1 minute on AniList.'
      : `Rate limited by ${provider}. Please wait ${Math.ceil(waitMs / 1000)}s.`;

    // Create and show toast
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #ef4444;
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      animation: slideUp 0.3s ease-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    // Remove after 5 seconds
    setTimeout(() => toast.remove(), 5000);
  } catch (e) {
    console.warn('Failed to show rate limit toast:', e);
  }
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
