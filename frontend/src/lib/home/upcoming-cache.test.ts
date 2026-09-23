import { describe, it, expect } from 'vitest';
import {
  isFresh, monthKeyFor, readMonthFromCache, writeMonthToCache,
  UPCOMING_MIN_REFRESH_MS, MAX_CACHED_MONTHS, UPCOMING_CACHE_VERSION,
} from './upcoming-cache';
import type { UpcomingRelease } from '../profile/stats-calculators';

function release(id: string, date: Date): UpcomingRelease {
  return {
    day: date.getDate(), month: date.getMonth() + 1, year: date.getFullYear(), releaseDate: date,
    title: id, type: 'anime', cover: '', externalId: id, popularity: 1,
  };
}

const NOW = Date.UTC(2026, 8, 23, 12);

describe('upcoming releases cache policy', () => {
  it('a month is fresh for UPCOMING_MIN_REFRESH_MS and stale afterwards', () => {
    expect(isFresh(NOW - UPCOMING_MIN_REFRESH_MS + 1, NOW)).toBe(true);
    expect(isFresh(NOW - UPCOMING_MIN_REFRESH_MS, NOW)).toBe(false);
    expect(isFresh(Number.NaN, NOW)).toBe(false);
    expect(UPCOMING_MIN_REFRESH_MS).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });

  it('round-trips a month with its dates and reports freshness', () => {
    const date = new Date(2026, 8, 30);
    const raw = writeMonthToCache(null, '2026-9', [release('anime:1', date)], NOW);
    const hit = readMonthFromCache(raw, '2026-9', NOW + 1000);
    expect(hit?.fresh).toBe(true);
    expect(hit?.releases[0].releaseDate.getTime()).toBe(date.getTime());
    expect(hit?.releases[0].externalId).toBe('anime:1');
    const stale = readMonthFromCache(raw, '2026-9', NOW + UPCOMING_MIN_REFRESH_MS + 1);
    expect(stale?.fresh).toBe(false);
    expect(stale?.releases).toHaveLength(1);
  });

  it('keeps neighbouring months side by side instead of one slot', () => {
    let raw = writeMonthToCache(null, '2026-9', [release('a', new Date(2026, 8, 1))], NOW);
    raw = writeMonthToCache(raw, '2026-10', [release('b', new Date(2026, 9, 1))], NOW + 1);
    expect(readMonthFromCache(raw, '2026-9', NOW + 2)?.releases[0].externalId).toBe('a');
    expect(readMonthFromCache(raw, '2026-10', NOW + 2)?.releases[0].externalId).toBe('b');
    expect(readMonthFromCache(raw, '2026-11', NOW + 2)).toBeNull();
  });

  it('prunes to the most recently saved MAX_CACHED_MONTHS', () => {
    let raw: string | null = null;
    for (let i = 0; i <= MAX_CACHED_MONTHS; i++) {
      raw = writeMonthToCache(raw, `2026-${i + 1}`, [], NOW + i);
    }
    expect(readMonthFromCache(raw, '2026-1', NOW + 10)).toBeNull();
    for (let i = 1; i <= MAX_CACHED_MONTHS; i++) {
      expect(readMonthFromCache(raw, `2026-${i + 1}`, NOW + 10)).not.toBeNull();
    }
  });

  it('ignores another version, garbage, or the old single-slot shape', () => {
    expect(readMonthFromCache('not json', '2026-9', NOW)).toBeNull();
    expect(readMonthFromCache(JSON.stringify({ version: UPCOMING_CACHE_VERSION - 1, monthKey: '2026-9', savedAt: NOW, releases: [] }), '2026-9', NOW)).toBeNull();
    expect(readMonthFromCache(JSON.stringify({ version: UPCOMING_CACHE_VERSION, months: null }), '2026-9', NOW)).toBeNull();
    // A newer version's blob is dropped on the next write, not merged.
    const raw = writeMonthToCache(JSON.stringify({ version: UPCOMING_CACHE_VERSION + 1, months: { '2026-8': { savedAt: NOW, releases: [] } } }), '2026-9', [], NOW);
    expect(readMonthFromCache(raw, '2026-8', NOW)).toBeNull();
  });

  it('keys months by local year and month', () => {
    expect(monthKeyFor(new Date(2026, 0, 31))).toBe('2026-1');
    expect(monthKeyFor(new Date(2026, 11, 1))).toBe('2026-12');
  });
});
