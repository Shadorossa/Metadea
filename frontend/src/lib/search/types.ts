// Shared search types live here, not in index.ts, so a provider can import
// its result shape without pulling in the dispatcher that imports every
// provider back — that round trip was one of the runtime import cycles.

export type MediaType =
  | 'all' | 'anime' | 'manga' | 'lnovel' | 'game'
  | 'vnovel'  | 'movie' | 'series' | 'book' | 'comic' | 'event' | 'character' | 'staff';

/**
 * Subset of media_catalog columns available from search APIs.
 * Field names match the DB schema (camelCase mapping of snake_case columns).
 */
export interface SearchResult {
  /** Matches media_catalog.external_id — e.g. "anime:918" */
  externalId: string;
  /** Matches media_catalog.type */
  type: MediaType;
  /** Matches media_catalog.format — e.g. "TV", "OVA", "MANGA" */
  format: string;
  /** Matches media_catalog.source — which API provided this result */
  source: 'anilist' | 'igdb' | 'tmdb' | 'openlibrary' | 'comicvine' | 'apisports';
  /** Matches media_catalog.title_main — primary display title */
  titleMain: string;
  /** Matches media_catalog.title_romaji — romanised title (AniList only) */
  titleRomaji: string | null;
  /** Matches media_catalog.title_native — original script title (AniList only) */
  titleNative: string | null;
  /** Matches media_catalog.cover_url */
  coverUrl: string | null;
  /** Matches media_catalog.release_year */
  releaseYear: number | null;
  /** Matches media_catalog.release_month */
  releaseMonth: number | null;
  /** Matches media_catalog.release_day */
  releaseDay: number | null;
  /** Matches media_catalog.score_global — normalised to 0–10 */
  scoreGlobal: number | null;
  /** Author names — populated by OpenLibrary search, null for other providers */
  authorNames?: string[] | null;
  /** First author key e.g. "/authors/OL26320A" — OpenLibrary only */
  authorKey?: string | null;
  /** Genre names, when the provider's own search response already carries
   *  them at no extra request cost (AniList, IGDB, TMDB). Open Library and
   *  Comic Vine's search endpoints don't expose genre data, so this is
   *  always empty for book/comic results. */
  genres: string[];
}

// A "season" is a calendar quarter (3 months) — Winter/Spring/Summer/Fall,
// same grouping anime seasons already use, just applied uniformly across
// every media type via release month/year instead of being anime-specific.
export type SeasonId = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
export const SEASON_MONTHS: Record<SeasonId, [number, number]> = {
  WINTER: [1, 3],
  SPRING: [4, 6],
  SUMMER: [7, 9],
  FALL: [10, 12],
};

// Real server-side narrowing (a fresh 100-result page matching these
// criteria), not a client-side filter over whatever page was already
// fetched — season only takes effect together with a year (a season alone
// has no fixed year to anchor a date range to).
export interface SearchFilters {
  year?: number;
  season?: SeasonId;
  genres?: string[];
}

// One page of search results, capped at ~50 per provider (see each
// provider's own file) so a single search never has to wait on an unbounded
// "fetch every page until exhausted" loop before showing anything — that
// used to be the main reason results took so long to appear (IGDB and
// OpenLibrary both did this). `hasMore` tells the UI whether a "Load more"
// click is worth showing.
export interface SearchPage {
  results: SearchResult[];
  hasMore: boolean;
}
