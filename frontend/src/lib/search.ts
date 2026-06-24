import { searchAniList }               from './api/anilist';
import { searchGames }                 from './api/igdb';
import { searchMovies, searchSeries }  from './api/tmdb';
import { searchBooks }                 from './api/openlibrary';

export type MediaType =
  | 'all' | 'anime' | 'manga' | 'novel' | 'game'
  | 'vnovel'  | 'movie' | 'series' | 'book' | 'user';

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
}

export async function search(
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  switch (mediaType) {
    case 'anime':  return searchAniList(searchQuery, 'ANIME', 'anime', signal);
    case 'manga':  return searchAniList(searchQuery, 'MANGA', 'manga', signal);
    case 'novel':  return searchAniList(searchQuery, 'MANGA', 'novel', signal, 'NOVEL');
    case 'game':   return searchGames(searchQuery, 'game', signal);
    case 'vnovel':     return searchGames(searchQuery, 'vnovel',   signal);
    case 'movie':  return searchMovies(searchQuery, signal);
    case 'series': return searchSeries(searchQuery, signal);
    case 'book':   return searchBooks(searchQuery, signal);
    // 'all', 'vnovel', 'user': pendientes de integrar
    default:       return [];
  }
}
