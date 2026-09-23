// Pure (de)serialisation and freshness rules for the Home calendar's
// "General" releases cache — the localStorage blob lib/home/upcoming-general.ts
// keeps so reopening Home, reloading, or flipping between adjacent months
// doesn't re-hit AniList/TMDB/IGDB. Kept free of storage and clocks so the
// policy is unit-testable.
import type { UpcomingRelease } from '../profile/stats-calculators';

// Minimum interval between two fetches of the same month. Nothing about a
// month's release list changes minute to minute; an hour also means any
// staleness from a query-logic change self-heals without a version bump.
export const UPCOMING_MIN_REFRESH_MS = 60 * 60 * 1000;

// Months kept side by side (the current one plus the neighbours the arrows
// reach), most recently saved first — the previous single-slot cache made
// every month-arrow round trip refetch both months.
export const MAX_CACHED_MONTHS = 4;

// Bump only for changes urgent enough not to wait out UPCOMING_MIN_REFRESH_MS.
// 6: one slot per month instead of one slot total.
export const UPCOMING_CACHE_VERSION = 6;

interface SerializedRelease extends Omit<UpcomingRelease, 'releaseDate'> {
  releaseDate: string; // ISO — Date doesn't survive JSON.stringify/parse as-is
}

export interface MonthCacheEntry {
  savedAt: number;
  releases: SerializedRelease[];
}

export interface UpcomingCacheBlob {
  version: number;
  months: Record<string, MonthCacheEntry>;
}

export interface CachedMonth {
  releases: UpcomingRelease[];
  /** False once the entry is older than UPCOMING_MIN_REFRESH_MS: still
   *  worth showing while a refresh runs, not worth skipping the refresh. */
  fresh: boolean;
}

export function monthKeyFor(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}`;
}

export function isFresh(savedAt: number, now: number, minIntervalMs = UPCOMING_MIN_REFRESH_MS): boolean {
  return Number.isFinite(savedAt) && now - savedAt < minIntervalMs;
}

function parseBlob(raw: string | null): UpcomingCacheBlob | null {
  if (!raw) return null;
  try {
    const blob = JSON.parse(raw) as Partial<UpcomingCacheBlob> | null;
    if (!blob || blob.version !== UPCOMING_CACHE_VERSION || typeof blob.months !== 'object' || blob.months === null) return null;
    return blob as UpcomingCacheBlob;
  } catch {
    return null;
  }
}

/** The cached month out of the serialised blob, or null when absent (or
 *  the blob is from another version / unparsable). */
export function readMonthFromCache(raw: string | null, monthKey: string, now: number): CachedMonth | null {
  const entry = parseBlob(raw)?.months[monthKey];
  if (!entry || !Array.isArray(entry.releases)) return null;
  return {
    releases: entry.releases.map(r => ({ ...r, releaseDate: new Date(r.releaseDate) })),
    fresh: isFresh(entry.savedAt, now),
  };
}

/** The blob with `monthKey` replaced by `releases` (saved at `now`), pruned
 *  to the MAX_CACHED_MONTHS most recently saved months. */
export function writeMonthToCache(raw: string | null, monthKey: string, releases: UpcomingRelease[], now: number): string {
  const months = { ...(parseBlob(raw)?.months ?? {}) };
  months[monthKey] = {
    savedAt: now,
    releases: releases.map(r => ({ ...r, releaseDate: r.releaseDate.toISOString() })),
  };
  const kept = Object.entries(months)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_CACHED_MONTHS);
  return JSON.stringify({ version: UPCOMING_CACHE_VERSION, months: Object.fromEntries(kept) } satisfies UpcomingCacheBlob);
}
