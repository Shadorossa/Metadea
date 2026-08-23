// sessionStorage-backed cache for "browse mode" search results — the top-N
// by rating shown for a type tab BEFORE the user types anything (see
// SearchIsland's isBrowseMode). Every media type's own top-rated list is
// read-mostly (rankings shift slowly), so re-fetching it from AniList/IGDB/
// TMDB every time a tab is revisited within the same session — switching
// tabs and back, navigating away and returning via Back, "Load more" after
// already having paged through once — was pure waste. Same pattern as
// media-cache.ts, kept separate since the cache key/shape here is a whole
// results page (type+page+filters), not one media entry.
import type { SearchPage } from './index';

const CACHE_PREFIX = 'search_browse_cache_v1:';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

interface CacheEntry { data: SearchPage; ts: number; }

export function getCachedBrowsePage(key: string): SearchPage | null {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
      sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    if (!Array.isArray(entry.data?.results)) {
      sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    return entry.data;
  } catch { return null; }
}

export function setCachedBrowsePage(key: string, data: SearchPage): void {
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* sessionStorage lleno */ }
}
