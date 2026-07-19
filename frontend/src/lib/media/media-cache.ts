// sessionStorage-backed cache for MediaPageData — extracted from
// mediaService.ts (still re-exported from there) so the cache concern is
// readable on its own, separate from provider dispatch/fetch orchestration.
import type { MediaPageData } from './types';

export const CACHE_PREFIX = 'media_cache_v3:';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

interface CacheEntry { data: MediaPageData; ts: number; }

export function getCachedMediaData(rawId: string): MediaPageData | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${rawId}`);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      sessionStorage.removeItem(`${CACHE_PREFIX}${rawId}`);
      return null;
    }
    // Cached entries from an older app version (before a field was added, or
    // written mid-bug) can have a shape that no longer matches MediaPageData
    // — treat that as a cache miss instead of handing malformed data to
    // callers that assume `.relations`/`.characters` are always arrays.
    if (!Array.isArray(entry.data?.relations) || !Array.isArray(entry.data?.characters)) {
      sessionStorage.removeItem(`${CACHE_PREFIX}${rawId}`);
      return null;
    }
    return entry.data;
  } catch { return null; }
}

export function setCachedMediaData(rawId: string, data: MediaPageData): void {
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${rawId}`, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* sessionStorage lleno */ }
}

// Patches just the relations field of an already-cached entry (used once the
// background transitive-relations fetch resolves), keeping its original
// timestamp so the TTL isn't reset. Exported so callers can gate the write
// behind their own "is this fetch still relevant" check — see the comment
// on fetchExtraRelations (mediaService.ts) for why this can't safely happen
// internally.
export function patchCachedRelations(rawId: string, relations: MediaPageData['relations']): void {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${rawId}`);
    if (!raw) return;
    const entry: CacheEntry = JSON.parse(raw);
    entry.data = { ...entry.data, relations };
    sessionStorage.setItem(`${CACHE_PREFIX}${rawId}`, JSON.stringify(entry));
  } catch { /* sessionStorage lleno */ }
}

export function invalidateCachedMediaData(rawId: string): void {
  try {
    sessionStorage.removeItem(`${CACHE_PREFIX}${rawId}`);
  } catch {}
}
