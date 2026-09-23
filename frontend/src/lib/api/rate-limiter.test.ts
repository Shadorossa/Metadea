import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../dom/toast', () => ({ showToast: vi.fn() }));
vi.mock('../../i18n/runtime', () => ({ getT: () => ({ settings: { anilist_rate_limit: 'limited' } }) }));

import { RateLimiter, HOST_BUDGETS, limiterForUrl, parseRetryAfterMs, reportRateLimited } from './rate-limiter';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

// Lets a promise chain progress without advancing the clock.
const flush = () => vi.advanceTimersByTimeAsync(0);

describe('RateLimiter', () => {
  it('lets maxRequests through immediately and queues the overflow until the window slides', async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 1000 });
    const order: string[] = [];
    limiter.acquire().then(() => order.push('a'));
    limiter.acquire().then(() => order.push('b'));
    limiter.acquire().then(() => order.push('c'));
    await flush();
    expect(order).toEqual(['a', 'b']);
    expect(limiter.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('serves a user-priority caller before queued background ones', async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    const order: string[] = [];
    await limiter.acquire();
    limiter.acquire('background').then(() => order.push('bg1'));
    limiter.acquire('background').then(() => order.push('bg2'));
    limiter.acquire('user').then(() => order.push('user'));
    await vi.advanceTimersByTimeAsync(1100);
    expect(order).toEqual(['user']);
    await vi.advanceTimersByTimeAsync(1100);
    expect(order).toEqual(['user', 'bg1']);
  });

  it('drops a queued caller whose signal aborts, without spending a slot', async () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000 });
    await limiter.acquire();
    const controller = new AbortController();
    const aborted = limiter.acquire('user', controller.signal);
    const survivor = limiter.acquire('user');
    const survivorDone = vi.fn();
    survivor.then(survivorDone);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(limiter.pending).toBe(1);
    await vi.advanceTimersByTimeAsync(1100);
    expect(survivorDone).toHaveBeenCalled();
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const limiter = new RateLimiter({ maxRequests: 5, windowMs: 1000 });
    const controller = new AbortController();
    controller.abort();
    await expect(limiter.acquire('user', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('pauseFor holds every caller until Retry-After elapses, even with free slots', async () => {
    const limiter = new RateLimiter({ maxRequests: 10, windowMs: 1000 });
    limiter.pauseFor(3000);
    const done = vi.fn();
    limiter.acquire().then(done);
    await vi.advanceTimersByTimeAsync(2500);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(done).toHaveBeenCalled();
  });

  it('reports the wait through onWait only when a caller actually has to wait', async () => {
    const onWait = vi.fn();
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000, onWait });
    await limiter.acquire();
    expect(onWait).not.toHaveBeenCalled();
    limiter.acquire();
    expect(onWait).toHaveBeenCalledTimes(1);
    expect(onWait.mock.calls[0][0]).toBeGreaterThan(0);
    expect(onWait.mock.calls[0][1]).toBe('user');
  });
});

describe('host budgets', () => {
  it('documents every browser-side provider host', () => {
    expect(Object.keys(HOST_BUDGETS).sort()).toEqual([
      'api.animethemes.moe',
      'api.themoviedb.org',
      'openlibrary.org',
      'v.animethemes.moe',
      'v1.basketball.api-sports.io',
      'v3.football.api-sports.io',
    ]);
    expect(HOST_BUDGETS['api.themoviedb.org']).toMatchObject({ maxRequests: 40, windowMs: 10_000 });
    expect(HOST_BUDGETS['openlibrary.org']).toMatchObject({ maxRequests: 1, windowMs: 1_000 });
  });

  it('keeps background waits on the video CDN quiet but still tells the user when their own request waits', async () => {
    vi.stubGlobal('window', new EventTarget());
    const { showToast } = await import('../dom/toast');
    const toast = vi.mocked(showToast);
    toast.mockClear();
    const url = 'https://v.animethemes.moe/Bleach2026-OP1.webm';
    expect(HOST_BUDGETS['v.animethemes.moe']).toMatchObject({ maxRequests: 3, windowMs: 30_000 });
    const limiter = limiterForUrl(url)!;
    for (let i = 0; i < 3; i++) await limiter.acquire('background');
    limiter.acquire('background');
    expect(toast).not.toHaveBeenCalled();
    limiter.acquire('user');
    expect(toast).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('routes a URL to one limiter per host and none for an unbudgeted host', () => {
    const a = limiterForUrl('https://api.themoviedb.org/3/search/movie?query=x');
    const b = limiterForUrl('https://api.themoviedb.org/3/search/tv?query=y');
    expect(a).toBe(b);
    expect(limiterForUrl('https://graphql.anilist.co')).not.toBeNull();
    expect(limiterForUrl('https://example.org/x')).toBeNull();
  });

  it('parses Retry-After as delta-seconds or an HTTP date, with a fallback', () => {
    expect(parseRetryAfterMs('7')).toBe(7000);
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfterMs('garbage')).toBe(5000);
    expect(parseRetryAfterMs(null)).toBe(5000);
  });

  it('a 429 report pauses that host budget for the Retry-After', async () => {
    reportRateLimited('https://openlibrary.org/search.json', '2');
    const done = vi.fn();
    limiterForUrl('https://openlibrary.org/x')!.acquire().then(done);
    await vi.advanceTimersByTimeAsync(1500);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(done).toHaveBeenCalled();
  });
});
