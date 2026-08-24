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
// Any IGDB size template segment ("t_cover_big", "t_1080p", "t_screenshot_huge",
// ...) — not just "_big" specifically. A stored cover_url isn't always
// "t_cover_big"; igdb-mapper.ts's own detail fetch used to (bug, since
// fixed) save it as "t_1080p" instead, which this used to just pass through
// unchanged since it only recognized the "_big" suffix. Matching the whole
// template segment generically means any size IGDB ever hands back for a
// cover — past or future — still gets downgraded for display here.
const IGDB_SIZE_RE = /\/t_[a-z0-9_]+\//;
const TMDB_SIZE_RE = /\/t\/p\/(?:w\d+|original)\//;
const OPENLIBRARY_SIZE_RE = /-[SML]\.jpg$/i;

export function toSmallCover(url: string | null | undefined): string {
  if (!url) return '';
  if (ANILIST_COVER_SIZE_RE.test(url)) return url.replace(ANILIST_COVER_SIZE_RE, '/cover/small/');
  if (url.includes('images.igdb.com') && IGDB_SIZE_RE.test(url)) return url.replace(IGDB_SIZE_RE, '/t_cover_small/');
  if (TMDB_SIZE_RE.test(url)) return url.replace(TMDB_SIZE_RE, '/t/p/w185/');
  if (OPENLIBRARY_SIZE_RE.test(url)) return url.replace(OPENLIBRARY_SIZE_RE, '-S.jpg');
  return url;
}

// Between toSmallCover and toLargeCover — for grids whose cards render
// bigger than a tiny list thumbnail but still don't need the full-size
// asset (Local's cover cache, see LocalMediaCard.tsx). IGDB has no distinct
// "medium" template between cover_small and cover_big (games route through
// their own dedicated disk cache in Videojuegos anyway, not this one), so
// it's left as-is here rather than guessing at a size that doesn't exist.
export function toMediumCover(url: string | null | undefined): string {
  if (!url) return '';
  if (ANILIST_COVER_SIZE_RE.test(url)) return url.replace(ANILIST_COVER_SIZE_RE, '/cover/medium/');
  if (TMDB_SIZE_RE.test(url)) return url.replace(TMDB_SIZE_RE, '/t/p/w342/');
  if (OPENLIBRARY_SIZE_RE.test(url)) return url.replace(OPENLIBRARY_SIZE_RE, '-M.jpg');
  return url;
}

// Opposite direction of toSmallCover, for the one context that wants the
// biggest asset a provider will actually hand back instead of a lighter
// one — the Instagram-story share image (share-image.ts), which is the
// only cover this app ever exports at near-full size rather than shrinking
// down into a small UI thumbnail. Same render-only guarantee: never touches
// what's persisted, media_catalog.cover_url keeps whatever size it was
// saved at (this mainly matters for TMDB, which persists posters at a
// small fixed "w300" size, and IGDB, whose stored "cover_big" template is
// sized for a grid thumbnail, not this — a stored AniList cover_url can
// also predate this app preferring extraLarge, so it's worth a try there
// too).
//
// AniList's "extraLarge" is a GraphQL field name, not guaranteed to be a
// distinct CDN path for every entry — some covers only ever had a "large"
// asset uploaded, in which case requesting ".../cover/extraLarge/..." 404s.
// Unlike the other three providers (verified, always-present size
// variants), this one isn't safe to swap unconditionally — see
// resolveCoverImage in share-image.ts, which tries this upgraded URL first
// and falls back to the original on failure instead of ending up with no
// cover at all.
export function toLargeCover(url: string | null | undefined): string {
  if (!url) return '';
  if (ANILIST_COVER_SIZE_RE.test(url)) return url.replace(ANILIST_COVER_SIZE_RE, '/cover/extraLarge/');
  if (url.includes('images.igdb.com') && IGDB_SIZE_RE.test(url)) return url.replace(IGDB_SIZE_RE, '/t_original/');
  if (TMDB_SIZE_RE.test(url)) return url.replace(TMDB_SIZE_RE, '/t/p/original/');
  if (OPENLIBRARY_SIZE_RE.test(url)) return url.replace(OPENLIBRARY_SIZE_RE, '-L.jpg');
  return url;
}
