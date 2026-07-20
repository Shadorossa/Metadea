import { readEnvConfig } from '../../tauri';
import type { MediaType, SearchResult, SearchPage } from '../index';
import { API_ENDPOINTS } from '../../api/endpoints';
import { fetchJson } from '../../api/client';
import { getLangCode } from '../../../i18n/client';
import { MissingApiKeyError } from '../errors';

interface TmdbMovie {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  genre_ids?: number[];
  original_language?: string;
  origin_country?: string[];
}

// TMDB genre id for "Animation". Japanese-language animation overlaps with
// AniList's anime catalog, so it's excluded here to avoid duplicate entries
// across the two providers.
const TMDB_GENRE_ANIMATION = 16;

function isAnime(movie: TmdbMovie): boolean {
  return movie.original_language === 'ja' && !!movie.genre_ids?.includes(TMDB_GENRE_ANIMATION);
}

interface TmdbPageResponse {
  results?: TmdbMovie[];
  page?: number;
  total_pages?: number;
}

interface TmdbGenre { id: number; name: string }
interface TmdbCompany { id: number; name: string }

interface TmdbCastMember {
  id: number;
  name: string;
  character?: string;
  profile_path: string | null;
  order?: number;
  /** Unique per casting (not per actor) — the same actor playing two
   *  different roles (or the same role across a dual-cast credit) gets two
   *  distinct credit_ids, unlike `id` which is the actor's own person id and
   *  would collide. Used to key each character card. */
  credit_id?: string;
}

interface TmdbCrewMember {
  id: number;
  name: string;
  job?: string;
  department?: string;
  profile_path: string | null;
  /** TV crew only — how many episodes this person actually worked on, used
   *  as a fallback "who's the real author" signal when neither created_by
   *  nor an Executive Producer credit is present. */
  episode_count?: number;
}

interface TmdbCredits {
  cast?: TmdbCastMember[];
  crew?: TmdbCrewMember[];
}

interface TmdbCreator {
  id: number;
  name: string;
  profile_path: string | null;
}

interface TmdbRecommendations {
  results?: TmdbMovie[];
}

// TV's age rating (content_ratings) is per-country, no single global value —
// same shape idea as movies' release_dates below, just without the nested
// per-release array.
interface TmdbContentRatings {
  results?: { iso_3166_1: string; rating: string }[];
}

// Movies' age rating (release_dates) nests certification one level deeper
// than TV's content_ratings, since a country can have multiple releases
// (theatrical/digital/etc.) each with their own certification.
interface TmdbReleaseDates {
  results?: { iso_3166_1: string; release_dates: { certification: string }[] }[];
}

// Shared fields between /movie/{id} and /tv/{id} detail responses.
interface TmdbDetailBase {
  id: number;
  overview?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average?: number;
  status?: string;
  genres?: TmdbGenre[];
  production_companies?: TmdbCompany[];
  origin_country?: string[];
  original_language?: string;
  // Populated via append_to_response=credits,recommendations,... on the detail fetch.
  credits?: TmdbCredits;
  recommendations?: TmdbRecommendations;
}

export interface TmdbMovieDetail extends TmdbDetailBase {
  title: string;
  original_title?: string;
  release_date?: string;
  runtime?: number | null;
  release_dates?: TmdbReleaseDates;
}

export interface TmdbTvDetail extends TmdbDetailBase {
  name: string;
  original_name?: string;
  first_air_date?: string;
  last_air_date?: string;
  number_of_episodes?: number;
  number_of_seasons?: number;
  episode_run_time?: number[];
  created_by?: TmdbCreator[];
  content_ratings?: TmdbContentRatings;
  /** TMDB's own show-type classification, always present on the detail
   *  response (no append_to_response needed) — a much more reliable source
   *  for "what kind of show is this" than inferring it from season/episode
   *  counts. One of: Documentary, News, Miniseries, Reality, Scripted,
   *  Talk Show, Video. */
  type?: string;
}

export function buildPosterUrl(posterPath: string | null): string | null {
  return posterPath ? API_ENDPOINTS.TMDB_IMAGE(posterPath) : null;
}

export function parseDateParts(dateString?: string): { year: number | null; month: number | null; day: number | null } {
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

// TMDB credentials can be a bearer access token, a plain api_key query param,
// or both (see settings/environment.ts) — resolve them once and let callers
// build their own query string / headers from the result.
export async function getTmdbAuth(): Promise<{ accessToken: string; apiKey: string } | null> {
  let accessToken = '';
  let apiKey = '';

  try {
    const cfg = await readEnvConfig();
    accessToken = cfg.tmdb_access_token ?? '';
    apiKey = cfg.tmdb_api_key ?? '';
  } catch {
    // Not in Tauri or config doesn't exist
  }

  if (!accessToken && !apiKey) return null;
  return { accessToken, apiKey };
}

export function tmdbLocale(): string {
  return getLangCode() === 'en' ? 'en-US' : 'es-ES';
}

async function fetchFromTmdb(
  endpoint: string,
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
  page: number,
): Promise<SearchPage> {
  const auth = await getTmdbAuth();
  if (!auth) throw new MissingApiKeyError(['tmdb']);

  // TMDB's own page size is fixed at 20 (not adjustable) — "page" here is
  // just TMDB's own page number, one request each, same as every other
  // provider's own pagination unit.
  let url = `${API_ENDPOINTS.TMDB}/${endpoint}?query=${encodeURIComponent(searchQuery)}&page=${page}&language=${tmdbLocale()}`;
  const headers: Record<string, string> = {};

  if (auth.accessToken) {
    headers['Authorization'] = `Bearer ${auth.accessToken}`;
  }

  if (auth.apiKey) {
    url += `&api_key=${encodeURIComponent(auth.apiKey)}`;
  }

  const data = await fetchJson<TmdbPageResponse>(url, { signal, headers });
  const results = (data?.results ?? [])
    .filter(movie => !isAnime(movie))
    .map(movie => mapTmdbMovieToSearchResult(movie, mediaType));
  const hasMore = !!(data?.page && data?.total_pages && data.page < data.total_pages);
  return { results, hasMore };
}

export const searchMovies = (searchQuery: string, signal: AbortSignal, page = 1) =>
  fetchFromTmdb('search/movie', searchQuery, 'movie', signal, page);

export const searchSeries = (searchQuery: string, signal: AbortSignal, page = 1) =>
  fetchFromTmdb('search/tv', searchQuery, 'series', signal, page);

// Full detail fetch for the media page — search results only carry title/
// cover/date/score, not overview, genres, runtime or production companies.
export async function fetchTmdbDetail(
  id: number,
  mediaType: 'movie' | 'series',
): Promise<TmdbMovieDetail | TmdbTvDetail | null> {
  const auth = await getTmdbAuth();
  if (!auth) return null;

  const path = mediaType === 'movie' ? 'movie' : 'tv';
  // append_to_response rides cast/crew (credits), similar titles
  // (recommendations), and the age rating (content_ratings for TV,
  // release_dates for movies — different endpoint names for the same idea)
  // along on the same request instead of extra round-trips.
  const ratingsField = mediaType === 'movie' ? 'release_dates' : 'content_ratings';
  let url = `${API_ENDPOINTS.TMDB}/${path}/${id}?language=${tmdbLocale()}&append_to_response=credits,recommendations,${ratingsField}`;
  const headers: Record<string, string> = {};

  if (auth.accessToken) headers['Authorization'] = `Bearer ${auth.accessToken}`;
  if (auth.apiKey) url += `&api_key=${encodeURIComponent(auth.apiKey)}`;

  return fetchJson<TmdbMovieDetail | TmdbTvDetail>(url, { headers });
}
