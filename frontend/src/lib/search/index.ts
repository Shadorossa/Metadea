import { searchAniList, searchAniListCharacters } from './providers/anilist';
import { searchGames, searchGameBundles, searchGameExpandedEditions } from './providers/igdb';
import { searchMovies, searchSeries }  from './providers/tmdb';
import { searchBooks }                 from './providers/openlibrary';
import { searchComics, searchComicVineCharacters } from './providers/comicvine';
import { MissingApiKeyError }          from './errors';
import { searchCatalog, type MediaCatalogEntry } from '../tauri/catalog';

export { MissingApiKeyError };
export { searchGameBundles, searchGameExpandedEditions };

export type MediaType =
  | 'all' | 'anime' | 'manga' | 'lnovel' | 'game'
  | 'vnovel'  | 'movie' | 'series' | 'book' | 'comic' | 'character';

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
  source: 'anilist' | 'igdb' | 'tmdb' | 'openlibrary' | 'comicvine';
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

// Every type folded into the "all" tab — deliberately excludes 'character',
// which stays its own dedicated tab/result shape.
const ALL_SEARCH_TYPES: MediaType[] = [
  'anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series', 'book', 'comic',
];

function fetchFromApi(
  mediaType: Exclude<MediaType, 'all'>,
  searchQuery: string,
  signal: AbortSignal,
  page: number,
): Promise<SearchPage> {
  switch (mediaType) {
    case 'anime':     return searchAniList(searchQuery, 'ANIME', 'anime', signal, undefined, page);
    case 'manga':     return searchAniList(searchQuery, 'MANGA', 'manga', signal, undefined, page);
    case 'lnovel':    return searchAniList(searchQuery, 'MANGA', 'lnovel', signal, 'NOVEL', page);
    case 'game':      return searchGames(searchQuery, 'game', signal, page);
    case 'vnovel':    return searchGames(searchQuery, 'vnovel', signal, page);
    case 'movie':     return searchMovies(searchQuery, signal, page);
    case 'series':    return searchSeries(searchQuery, signal, page);
    case 'book':      return searchBooks(searchQuery, signal, page);
    case 'comic':     return searchComics(searchQuery, signal, page);
    case 'character': return searchCharacters(searchQuery, signal, page);
    default:          return Promise.resolve({ results: [], hasMore: false });
  }
}

// Fans out to every provider with real, independently-searchable character
// entities — AniList and Comic Vine both have these; TMDB doesn't (a TMDB
// "character" is just a text field on a cast credit, not its own searchable
// resource), so it has no equivalent branch here. A provider erroring
// (missing API key, network) doesn't take the other one down with it.
async function searchCharacters(searchQuery: string, signal: AbortSignal, page: number): Promise<SearchPage> {
  const [anilistPage, comicvinePage] = await Promise.all([
    searchAniListCharacters(searchQuery, signal, page).catch(() => ({ results: [], hasMore: false } as SearchPage)),
    searchComicVineCharacters(searchQuery, signal, page).catch(() => ({ results: [], hasMore: false } as SearchPage)),
  ]);
  return {
    results: [...anilistPage.results, ...comicvinePage.results],
    hasMore: anilistPage.hasMore || comicvinePage.hasMore,
  };
}

function catalogEntryToSearchResult(entry: MediaCatalogEntry): SearchResult {
  return {
    externalId: entry.external_id,
    type: entry.type as MediaType,
    format: entry.format || '',
    source: (entry.source as SearchResult['source']) || 'igdb',
    titleMain: entry.title_main || entry.external_id,
    titleRomaji: entry.title_romaji ?? null,
    titleNative: entry.title_native ?? null,
    coverUrl: entry.cover_url ?? null,
    releaseYear: entry.release_year ?? null,
    releaseMonth: entry.release_month ?? null,
    releaseDay: entry.release_day ?? null,
    scoreGlobal: entry.score_global ?? null,
  };
}

// Same "not its own search hit" formats igdb_search excludes on the live
// side (Rust, igdb.rs) — a local catalog row can carry one of these (e.g.
// synced from the community catalog, or fetched before format tracking
// existed) and without this it'd not-so-quietly reappear here even though
// the live path was specifically made to hide it.
const EXCLUDED_LOCAL_FORMATS = new Set(['REMASTER', 'EXPANDED_GAME', 'UPDATE', 'DLC', 'MOD', 'PORT', 'FORK', 'BUNDLE']);

// Whole-word match only — mirrors name_has_edition_word in igdb.rs so
// "Expedition 33" isn't caught by a plain "edition" substring check.
function titleHasEditionWord(title: string): boolean {
  return title.split(/[^a-zA-Z0-9]+/).some(tok => tok.toLowerCase() === 'edition');
}

// Local catalog entries the live API doesn't surface (IGDB's normal search
// filters out titles missing a cover or with an unusual category — see
// AdminAddSearch's unfiltered search, used precisely to find and add those)
// still deserve to be findable afterward through the regular search, once
// they're already in the local catalog. Not paginated — only checked on
// page 1, merged in without overriding an API hit for the same id (the live
// result is generally fresher/richer).
async function searchLocalCatalog(searchQuery: string, mediaType: Exclude<MediaType, 'all' | 'character'>): Promise<SearchResult[]> {
  const entries = await searchCatalog(searchQuery).catch(() => [] as MediaCatalogEntry[]);
  return entries
    .filter(e => e.type === mediaType)
    // Guards against stray rows whose external_id doesn't actually start
    // with "{type}:" (e.g. saved with a malformed id by an older, since-
    // fixed write path) — those would otherwise surface here with a broken
    // id that can't resolve to anything when picked.
    .filter(e => e.external_id.startsWith(`${e.type}:`))
    .filter(e => !e.format || !EXCLUDED_LOCAL_FORMATS.has(e.format))
    .filter(e => (mediaType !== 'game' && mediaType !== 'vnovel') || !titleHasEditionWord(e.title_main || ''))
    .map(catalogEntryToSearchResult);
}

async function searchOne(
  mediaType: Exclude<MediaType, 'all'>,
  searchQuery: string,
  signal: AbortSignal,
  page: number,
): Promise<SearchPage> {
  const apiPromise = fetchFromApi(mediaType, searchQuery, signal, page);
  if (mediaType === 'character' || page !== 1) return apiPromise;

  const [apiOutcome, localResults] = await Promise.all([
    apiPromise.then(p => ({ ok: true as const, page: p })).catch(err => ({ ok: false as const, err })),
    searchLocalCatalog(searchQuery, mediaType),
  ]);

  if (!apiOutcome.ok) {
    // Preserve existing error surfacing (e.g. MissingApiKeyError prompts the
    // user to add an API key) when there's nothing else to show — but a
    // local-only hit is still a valid result even if the live provider
    // couldn't be reached.
    if (localResults.length === 0) throw apiOutcome.err;
    return { results: localResults, hasMore: false };
  }

  const seen = new Set(apiOutcome.page.results.map(r => r.externalId));
  const extraLocal = localResults.filter(r => !seen.has(r.externalId));
  return { results: [...apiOutcome.page.results, ...extraLocal], hasMore: apiOutcome.page.hasMore };
}

// Fans out to every provider in parallel and merges what comes back. A
// provider missing its API key (IGDB, TMDB) rejects with MissingApiKeyError
// instead of silently contributing zero results — that's swallowed here as
// long as *something* else came back, and only surfaced (as a combined
// MissingApiKeyError) when literally nothing did, so the UI can tell "no
// matches" apart from "can't search these types at all yet".
async function searchAll(searchQuery: string, signal: AbortSignal, page: number): Promise<SearchPage> {
  const settled = await Promise.allSettled(
    ALL_SEARCH_TYPES.map(type => searchOne(type, searchQuery, signal, page)),
  );

  const results: SearchResult[] = [];
  let hasMore = false;
  const missingKeyProviders = new Set<string>();
  let sawOtherError = false;

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value.results);
      hasMore = hasMore || outcome.value.hasMore;
      continue;
    }
    const reason = outcome.reason;
    if (reason instanceof MissingApiKeyError) {
      reason.providers.forEach(p => missingKeyProviders.add(p));
    } else if (reason instanceof Error && reason.name === 'AbortError') {
      // The whole search was cancelled (new query/type) — propagate
      // immediately instead of reporting a misleading "missing keys" or
      // "generic error" state for a request nobody cares about anymore.
      throw reason;
    } else {
      sawOtherError = true;
    }
  }

  if (results.length === 0 && missingKeyProviders.size > 0 && !sawOtherError) {
    throw new MissingApiKeyError([...missingKeyProviders]);
  }

  return { results: dedupeByExternalId(results), hasMore };
}

// searchOne() already merges a type's own local-catalog hits against that
// same type's live API results without duplicating an externalId — but
// searchAll() fans out to every type in parallel and just concatenates each
// type's own already-deduped list, so a work that (for whatever reason) has
// a catalog row filed under one type but a live hit under another one for
// the same query would still reach the UI twice. Keeps first occurrence
// (API results are pushed before any type's local-only extras, so a live
// hit always wins over a local-only one for the same id).
function dedupeByExternalId(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter(r => {
    if (seen.has(r.externalId)) return false;
    seen.add(r.externalId);
    return true;
  });
}

export async function search(
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
  page = 1,
): Promise<SearchPage> {
  if (mediaType === 'all') return searchAll(searchQuery, signal, page);
  return searchOne(mediaType, searchQuery, signal, page);
}
