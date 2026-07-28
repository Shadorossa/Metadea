// AniList, IGDB, TMDB and Open Library all serve the exact same cover image
// at multiple sizes via a size keyword baked into the URL path itself,
// rather than a separate endpoint per size — swapping that keyword lets any
// grid of many small thumbnails (profile library, search results, ...)
// request a lighter asset than whatever size the URL already points at, at
// render time only. Nothing persisted (media_catalog.cover_url, a live
// search result's own coverUrl) is ever touched, so every other context
// (the media page's own big cover, etc.) keeps using the size it already had.
//
// Comic Vine deliberately isn't handled here: unlike the other four, its API
// hands back separate medium_url/small_url strings rather than one URL with
// a swappable size segment, and its real CDN path convention couldn't be
// verified live (its API needs a key this environment doesn't have, and its
// site 403s plain scraping) — guessing here risks silently broken comic
// covers instead of just missing out on a smaller one.
const ANILIST_COVER_SIZE_RE = /\/cover\/(?:large|medium|small)\//;
const IGDB_BIG_SUFFIX_RE = /_big(?=\/)/;
const TMDB_SIZE_RE = /\/t\/p\/(?:w\d+|original)\//;
const OPENLIBRARY_SIZE_RE = /-[SML]\.jpg$/i;

export function toSmallCover(url: string | null | undefined): string {
  if (!url) return '';
  if (ANILIST_COVER_SIZE_RE.test(url)) return url.replace(ANILIST_COVER_SIZE_RE, '/cover/small/');
  if (IGDB_BIG_SUFFIX_RE.test(url)) return url.replace(IGDB_BIG_SUFFIX_RE, '_small');
  if (TMDB_SIZE_RE.test(url)) return url.replace(TMDB_SIZE_RE, '/t/p/w185/');
  if (OPENLIBRARY_SIZE_RE.test(url)) return url.replace(OPENLIBRARY_SIZE_RE, '-S.jpg');
  return url;
}
