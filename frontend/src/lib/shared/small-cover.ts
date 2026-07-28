// AniList and IGDB both serve the exact same cover image at multiple sizes
// via a size keyword baked into the URL path itself, rather than a separate
// endpoint per size — swapping that keyword lets a caller (the profile
// library grid, which renders many small thumbnails at once) request a
// lighter asset than whatever size got persisted to media_catalog.cover_url,
// at render time only. The stored cover_url itself is never touched, so
// every other context (the media page's own big cover, etc.) keeps using
// the size it already had.
const ANILIST_COVER_SIZE_RE = /\/cover\/(?:large|medium|small)\//;
const IGDB_BIG_SUFFIX_RE = /_big(?=\/)/;

export function toSmallLibraryCover(url: string | null | undefined): string {
  if (!url) return '';
  if (ANILIST_COVER_SIZE_RE.test(url)) return url.replace(ANILIST_COVER_SIZE_RE, '/cover/small/');
  if (IGDB_BIG_SUFFIX_RE.test(url)) return url.replace(IGDB_BIG_SUFFIX_RE, '_small');
  return url;
}
