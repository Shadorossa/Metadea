import { showToast } from '../dom/toast';
import { getT } from '../../i18n/runtime';

/**
 * Client-side sliding-window rate limiter — queues calls so they never
 * exceed `maxRequests` within any `windowMs` window, instead of firing them
 * all immediately and letting the provider itself reject the overflow with
 * a 429 (which can also lead to a longer, provider-side ban if it keeps
 * happening).
 *
 * Queued callers are served by priority ('user' before 'background', FIFO
 * within a priority) so a search the user is typing never waits behind a
 * background enrichment burst, and a caller whose AbortSignal fires while
 * still queued is dropped without consuming a slot. `pauseFor` honours a
 * provider's own Retry-After on a 429: nothing is released from the queue
 * until that pause elapses.
 */
export type RequestPriority = 'user' | 'background';

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
  /** Called (each time a caller has to wait) with how long the wait will be. */
  onWait?: (waitMs: number, priority: RequestPriority) => void;
  /** Injectable clock — tests only. Defaults to Date.now. */
  now?: () => number;
}

interface Waiter {
  priority: RequestPriority;
  order: number;
  signal?: AbortSignal;
  resolve: () => void;
  reject: (err: unknown) => void;
  onAbort?: () => void;
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

export class RateLimiter {
  private timestamps: number[] = [];
  private waiters: Waiter[] = [];
  private nextOrder = 0;
  private pausedUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private opts: RateLimiterOptions) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  /** Resolves once it's safe to fire the next request, waiting if needed. */
  acquire(priority: RequestPriority = 'user', signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { priority, order: this.nextOrder++, signal, resolve, reject };
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index !== -1) {
            this.waiters.splice(index, 1);
            reject(abortError());
          }
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      this.waiters.push(waiter);
      this.waiters.sort((a, b) => (a.priority === b.priority ? a.order - b.order : a.priority === 'user' ? -1 : 1));
      const wait = this.msUntilNextSlot();
      if (wait > 0) this.opts.onWait?.(wait, priority);
      this.pump();
    });
  }

  /** Honour a provider's Retry-After: hold every queued caller for `ms`. */
  pauseFor(ms: number): void {
    if (!(ms > 0)) return;
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
    this.schedule();
  }

  /** Requests still waiting for a slot. */
  get pending(): number {
    return this.waiters.length;
  }

  private pruneTimestamps(now: number): void {
    this.timestamps = this.timestamps.filter(t => now - t < this.opts.windowMs);
  }

  private msUntilNextSlot(): number {
    const now = this.now();
    this.pruneTimestamps(now);
    const pauseWait = Math.max(0, this.pausedUntil - now);
    if (this.timestamps.length < this.opts.maxRequests) return pauseWait;
    const windowWait = this.opts.windowMs - (now - this.timestamps[0]) + 25;
    return Math.max(pauseWait, windowWait);
  }

  private pump(): void {
    for (;;) {
      if (this.waiters.length === 0) return;
      if (this.msUntilNextSlot() > 0) {
        this.schedule();
        return;
      }
      const waiter = this.waiters.shift();
      if (!waiter) return;
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
      this.timestamps.push(this.now());
      waiter.resolve();
    }
  }

  private schedule(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.waiters.length === 0) return;
    const wait = this.msUntilNextSlot();
    if (wait <= 0) {
      this.pump();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pump();
    }, wait);
  }
}

function notifyRateLimitWait(provider: string, waitMs: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('metadea:rate-limit-wait', { detail: { provider, waitMs } }));

  const message = provider === 'AniList'
    ? getT().settings.anilist_rate_limit
    : `Rate limited by ${provider}. Please wait ${Math.ceil(waitMs / 1000)}s.`;

  showToast(message, {
    warningLabel: 'Failed to show rate limit toast:',
  });
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

// ── Per-host budgets ─────────────────────────────────────────────────────────
// One row per external hostname the app talks to from the WebView, with the
// provider's own published ceiling (or a polite self-imposed one where the
// provider only asks for "reasonable" use). Keyed by hostname so any caller
// that has a URL can route through `acquireForUrl` without knowing which
// provider it is; add a row here to put a new host on a budget — a host with
// no row is simply not limited client-side. IGDB and Comic Vine are missing
// on purpose: those requests are made from Rust (igdb/client.rs,
// comicvine.rs), which enforce their own budgets there.
export interface HostBudget {
  maxRequests: number;
  windowMs: number;
  /** Provider name for the wait toast. */
  label: string;
  /** No wait toast for 'background' callers — for hosts whose background
   *  work queues all the time by design, where the toast would be noise. */
  quietBackground?: boolean;
}

export const HOST_BUDGETS: Record<string, HostBudget> = {
  // 40 requests per 10 s is TMDB's historical documented ceiling; it's
  // formally unlimited today but bursts above ~50/s still get 429s.
  'api.themoviedb.org': { maxRequests: 40, windowMs: 10_000, label: 'TMDB' },
  // Open Library asks for at most ~1 request/s from a single client.
  'openlibrary.org': { maxRequests: 1, windowMs: 1_000, label: 'Open Library' },
  // API-Sports' free plan is 10 requests/min (paid plans go up to 300+/min
  // — raise this row to match the user's plan if it ever becomes a setting).
  'v3.football.api-sports.io': { maxRequests: 10, windowMs: 60_000, label: 'API-Sports' },
  'v1.basketball.api-sports.io': { maxRequests: 10, windowMs: 60_000, label: 'API-Sports' },
  // AnimeThemes documents 90 requests/min for its API.
  'api.animethemes.moe': { maxRequests: 60, windowMs: 60_000, label: 'AnimeThemes' },
  // The OP/ED video CDN is far stricter and undocumented: measured from one
  // IP, a burst of ~4 then about one request per 10 s, answering 503 (no
  // Retry-After) past that — and a single failed <video> load there is what
  // the OP/ED overlay used to show as "could not be loaded". Media elements
  // can't be queued, so callers take a slot before assigning a src (the
  // overlay as 'user') or before asking Rust to download one (the preview
  // capture queue and hover warm-up, as 'background').
  'v.animethemes.moe': { maxRequests: 3, windowMs: 30_000, label: 'AnimeThemes', quietBackground: true },
};

const limitersByHost = new Map<string, RateLimiter>([['graphql.anilist.co', anilistRateLimiter]]);

function hostOf(urlOrHost: string): string {
  try { return new URL(urlOrHost).hostname; } catch { return urlOrHost; }
}

/** The limiter that governs this URL's host, or null when it has no budget row. */
export function limiterForUrl(urlOrHost: string): RateLimiter | null {
  const host = hostOf(urlOrHost);
  const existing = limitersByHost.get(host);
  if (existing) return existing;
  const budget = HOST_BUDGETS[host];
  if (!budget) return null;
  const limiter = new RateLimiter({
    maxRequests: budget.maxRequests,
    windowMs: budget.windowMs,
    onWait: (waitMs, priority) => {
      if (budget.quietBackground && priority === 'background') return;
      notifyRateLimitWait(budget.label, waitMs);
    },
  });
  limitersByHost.set(host, limiter);
  return limiter;
}

/** Waits for a slot on the URL's host budget (no-op for an unbudgeted host). */
export function acquireForUrl(url: string, priority: RequestPriority = 'user', signal?: AbortSignal): Promise<void> {
  const limiter = limiterForUrl(url);
  return limiter ? limiter.acquire(priority, signal) : Promise.resolve();
}

// Retry-After is either delta-seconds or an HTTP date. A 429 with no usable
// header still pauses briefly so the queue doesn't immediately re-hit the
// same ceiling.
const DEFAULT_RETRY_AFTER_MS = 5_000;

export function parseRetryAfterMs(header: string | null | undefined, now = Date.now()): number {
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return DEFAULT_RETRY_AFTER_MS;
  return Math.max(0, date - now);
}

/** A provider answered 429: pause that host's queue for its Retry-After. */
export function reportRateLimited(url: string, retryAfterHeader: string | null | undefined): void {
  limiterForUrl(url)?.pauseFor(parseRetryAfterMs(retryAfterHeader));
}
