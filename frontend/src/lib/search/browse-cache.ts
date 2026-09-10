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
import { sessionCacheGet, sessionCacheSet } from '../shared/session-ttl-cache';

const CACHE_PREFIX = 'search_browse_cache_v1:';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min

export function getCachedBrowsePage(key: string): SearchPage | null {
  const data = sessionCacheGet<SearchPage>(CACHE_PREFIX, key);
  // Cached entries from an older app version can have a shape that no
  // longer matches SearchPage — treat that as a cache miss.
  if (!Array.isArray(data?.results)) return null;
  return data;
}

export function setCachedBrowsePage(key: string, data: SearchPage): void {
  sessionCacheSet(CACHE_PREFIX, key, data, CACHE_TTL_MS);
}
