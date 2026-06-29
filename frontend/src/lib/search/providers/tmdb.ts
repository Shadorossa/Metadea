import { readEnvConfig } from '../../tauri';
import type { MediaType, SearchResult } from '../index';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w300';

interface TmdbMovie {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
}

interface TmdbPageResponse {
  results?: TmdbMovie[];
}

function buildPosterUrl(posterPath: string | null): string | null {
  return posterPath ? `${TMDB_IMAGE_BASE_URL}${posterPath}` : null;
}

function parseDateParts(dateString?: string): { year: number | null; month: number | null; day: number | null } {
  if (!dateString) return { year: null, month: null, day: null };
  // TMDB dates are "YYYY-MM-DD" with no time component — JS parses them as UTC midnight,
  // so local-time methods (getFullYear etc.) can return the previous day in negative offsets.
  const date = new Date(dateString);
  return {
    year:  date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day:   date.getUTCDate(),
  };
}

function mapTmdbMovieToSearchResult(movie: TmdbMovie, mediaType: MediaType): SearchResult {
  const { year, month, day } = parseDateParts(movie.release_date ?? movie.first_air_date);
  return {
    externalId: `${mediaType}:${movie.id}`,
    type: mediaType,
    format: '',
    source: 'tmdb',
    titleMain: movie.title ?? movie.name ?? '',
    titleRomaji: null,
    titleNative: null,
    coverUrl: buildPosterUrl(movie.poster_path),
    releaseYear: year,
    releaseMonth: month,
    releaseDay: day,
    scoreGlobal: movie.vote_average ? Math.round(movie.vote_average * 10) / 10 : null,
  };
}

async function fetchFromTmdb(
  endpoint: string,
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  let accessToken = '';
  let apiKey = '';

  try {
    const cfg = await readEnvConfig();
    accessToken = cfg.tmdb_access_token ?? '';
    apiKey = cfg.tmdb_api_key ?? '';
  } catch {
    // Not in Tauri or config doesn't exist
  }

  if (!accessToken && !apiKey) return [];

  let url = `${TMDB_BASE_URL}/${endpoint}?query=${encodeURIComponent(searchQuery)}&page=1&language=es-ES`;
  const headers: Record<string, string> = {};

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  if (apiKey) {
    url += `&api_key=${encodeURIComponent(apiKey)}`;
  }

  const response = await fetch(url, { signal, headers });

  if (!response.ok) return [];
  const data: TmdbPageResponse = await response.json();
  return (data.results ?? []).map(movie => mapTmdbMovieToSearchResult(movie, mediaType));
}

export const searchMovies = (searchQuery: string, signal: AbortSignal) =>
  fetchFromTmdb('search/movie', searchQuery, 'movie', signal);

export const searchSeries = (searchQuery: string, signal: AbortSignal) =>
  fetchFromTmdb('search/tv', searchQuery, 'series', signal);
