import { getCachedCoversBatch } from '../tauri';
import { getCoverPreference, readCoverPreferences } from '../media/cover-preferences';

// AniList works (anime/manga/lnovel) deliberately bypass the disk cover
// cache everywhere (see LocalMediaCard/useCoverCacheBatch) — never worth an
// exists-check for those.
const UNCACHED_ID_RE = /^(?:anime|manga|lnovel):/i;

// Which of these ids may be painted from the disk cover cache: not an
// AniList work, and no user-picked cover override — the cache holds
// whatever URL Local downloaded at the time, so a work whose cover the user
// replaced via the editor keeps showing that choice (via cover_url) instead
// of the stale cached file. Deduplicated; order preserved.
export function filterCoverCacheCandidates(externalIds: Iterable<string>): string[] {
  const preferences = readCoverPreferences();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of externalIds) {
    if (!id || seen.has(id) || UNCACHED_ID_RE.test(id)) continue;
    seen.add(id);
    if (getCoverPreference(id, preferences)) continue;
    out.push(id);
  }
  return out;
}

// One existence-only IPC call for a handful of covers about to be rendered
// from string HTML / plain props (the Overview's Hall of Fame and monthly
// history), so already-cached ones load from disk like Local's grids do
// instead of hitting the remote CDN on every visit. Misses simply aren't in
// the map — callers keep their remote URL for those. Never throws.
export async function resolveCachedCoverPaths(externalIds: Iterable<string>): Promise<Map<string, string>> {
  const ids = filterCoverCacheCandidates(externalIds);
  if (ids.length === 0) return new Map();
  const hits = await getCachedCoversBatch(ids).catch(() => ({} as Record<string, string>));
  return new Map(Object.entries(hits));
}
