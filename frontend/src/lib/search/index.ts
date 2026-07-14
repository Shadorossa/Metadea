import { searchAniList, searchAniListCharacters } from './providers/anilist';
import { searchGames }                 from './providers/igdb';
import { searchMovies, searchSeries }  from './providers/tmdb';
import { searchBooks, searchComics }   from './providers/openlibrary';
import { MissingApiKeyError }          from './errors';

export { MissingApiKeyError };

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
  source: 'anilist' | 'igdb' | 'tmdb' | 'openlibrary';
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

// Every type folded into the "all" tab — deliberately excludes 'character',
// which stays its own dedicated tab/result shape.
const ALL_SEARCH_TYPES: MediaType[] = [
  'anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series', 'book', 'comic',
];

async function searchOne(
  mediaType: Exclude<MediaType, 'all'>,
  searchQuery: string,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  switch (mediaType) {
    case 'anime':     return searchAniList(searchQuery, 'ANIME', 'anime', signal);
    case 'manga':     return searchAniList(searchQuery, 'MANGA', 'manga', signal);
    case 'lnovel':    return searchAniList(searchQuery, 'MANGA', 'lnovel', signal, 'NOVEL');
    case 'game':      return searchGames(searchQuery, 'game', signal);
    case 'vnovel':    return searchGames(searchQuery, 'vnovel', signal);
    case 'movie':     return searchMovies(searchQuery, signal);
    case 'series':    return searchSeries(searchQuery, signal);
    case 'book':      return searchBooks(searchQuery, signal);
    case 'comic':     return searchComics(searchQuery, signal);
    case 'character': return searchAniListCharacters(searchQuery, signal);
    default:          return [];
  }
}

// Fans out to every provider in parallel and merges what comes back. A
// provider missing its API key (IGDB, TMDB) rejects with MissingApiKeyError
// instead of silently contributing zero results — that's swallowed here as
// long as *something* else came back, and only surfaced (as a combined
// MissingApiKeyError) when literally nothing did, so the UI can tell "no
// matches" apart from "can't search these types at all yet".
async function searchAll(searchQuery: string, signal: AbortSignal): Promise<SearchResult[]> {
  const settled = await Promise.allSettled(
    ALL_SEARCH_TYPES.map(type => searchOne(type, searchQuery, signal)),
  );

  const results: SearchResult[] = [];
  const missingKeyProviders = new Set<string>();
  let sawOtherError = false;

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      results.push(...outcome.value);
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

  return results;
}

export async function search(
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  if (mediaType === 'all') return searchAll(searchQuery, signal);
  return searchOne(mediaType, searchQuery, signal);
}
