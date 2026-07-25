import { readEnvConfig } from '../../tauri';
import type { MediaType, SearchResult, SearchPage, SearchFilters } from '../index';
import { SEASON_MONTHS } from '../index';
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
interface TmdbCompany { id: number; name: string; logo_path?: string | null }

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
  /** The channel/streaming platform that airs the show (Netflix, HBO, TV
   *  Tokyo, ...) — always present on the detail response, no
   *  append_to_response needed. Distinct from production_companies (the
   *  studio that actually makes it) the same way a game's publisher is
   *  distinct from its developer; movies have no equivalent field. */
  networks?: TmdbCompany[];
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

// TMDB's genre id -> name lists are static/public and haven't changed in
// years, but movie and TV shows use two DIFFERENT id spaces (e.g. 10759 is
// "Action & Adventure" for TV, unused for movies; 28 is "Action" for movies,
// unused for TV) — https://developer.themoviedb.org/reference/genre-movie-list
// and .../genre-tv-list. A dedicated request just to fetch these would be
// wasted traffic for values this stable.
const TMDB_MOVIE_GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};

const TMDB_TV_GENRES: Record<number, string> = {
  10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery',
  10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap',
  10767: 'Talk', 10768: 'War & Politics', 37: 'Western',
};

function reverseGenreMap(map: Record<number, string>): Record<string, number> {
  return Object.fromEntries(Object.entries(map).map(([id, name]) => [name, Number(id)]));
}
const TMDB_MOVIE_GENRE_IDS = reverseGenreMap(TMDB_MOVIE_GENRES);
const TMDB_TV_GENRE_IDS = reverseGenreMap(TMDB_TV_GENRES);
export const TMDB_MOVIE_GENRE_NAMES = Object.values(TMDB_MOVIE_GENRES);
export const TMDB_TV_GENRE_NAMES = Object.values(TMDB_TV_GENRES);

function mapTmdbMovieToSearchResult(movie: TmdbMovie, mediaType: MediaType): SearchResult {
  const { year, month, day } = parseDateParts(movie.release_date ?? movie.first_air_date);
  const genreMap = mediaType === 'series' ? TMDB_TV_GENRES : TMDB_MOVIE_GENRES;
  const genres = (movie.genre_ids ?? []).map(id => genreMap[id]).filter((g): g is string => !!g);
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
    genres,
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

// TMDB's own page size is fixed at 20 (not adjustable via any request param)
// — this app's own page size is 100 across every provider, so one logical
// page here means 5 TMDB sub-pages fetched in parallel and merged.
const TMDB_SUBPAGES_PER_PAGE = 5;

async function fetchTmdbPage(
  endpoint: string,
  extraParams: string,
  mediaType: MediaType,
  signal: AbortSignal,
  page: number,
): Promise<SearchPage> {
  const auth = await getTmdbAuth();
  if (!auth) throw new MissingApiKeyError(['tmdb']);

  const headers: Record<string, string> = {};
  if (auth.accessToken) {
    headers['Authorization'] = `Bearer ${auth.accessToken}`;
  }

  const buildUrl = (tmdbPage: number) => {
    let url = `${API_ENDPOINTS.TMDB}/${endpoint}?${extraParams ? `${extraParams}&` : ''}page=${tmdbPage}&language=${tmdbLocale()}`;
    if (auth.apiKey) url += `&api_key=${encodeURIComponent(auth.apiKey)}`;
    return url;
  };

  const firstSubPage = (page - 1) * TMDB_SUBPAGES_PER_PAGE + 1;
  const subPages = await Promise.all(
    Array.from({ length: TMDB_SUBPAGES_PER_PAGE }, (_, i) =>
      fetchJson<TmdbPageResponse>(buildUrl(firstSubPage + i), { signal, headers }),
    ),
  );

  const results: SearchResult[] = [];
  let hasMore = false;
  for (const data of subPages) {
    if (!data) continue;
    results.push(
      ...(data.results ?? [])
        .filter(movie => !isAnime(movie))
        .map(movie => mapTmdbMovieToSearchResult(movie, mediaType)),
    );
    if (data.page && data.total_pages && data.page < data.total_pages) hasMore = true;
  }
  return { results, hasMore };
}

export const searchMovies = (searchQuery: string, signal: AbortSignal, page = 1) =>
  fetchTmdbPage('search/movie', `query=${encodeURIComponent(searchQuery)}`, 'movie', signal, page);

export const searchSeries = (searchQuery: string, signal: AbortSignal, page = 1) =>
  fetchTmdbPage('search/tv', `query=${encodeURIComponent(searchQuery)}`, 'series', signal, page);

// TMDB's /discover endpoint (unlike /search) has no free-text query param at
// all, but does support the year/genre filters this app's toolbar offers —
// year+season become a primary_release_date/first_air_date range (same
// calendar-quarter convention used everywhere else), genre names are mapped
// back to TMDB's own stable ids. sort_by + a vote_count floor keep "top
// rated" meaning the same thing discover's own default (popularity) doesn't:
// well-regarded by a real audience, not lucky with a couple of 10/10 votes.
function discoverParamsFromFilters(mediaType: 'movie' | 'series', filters?: SearchFilters): string {
  const params = ['sort_by=vote_average.desc', 'vote_count.gte=50'];
  const genreIds = mediaType === 'series' ? TMDB_TV_GENRE_IDS : TMDB_MOVIE_GENRE_IDS;

  if (filters?.genres?.length) {
    const ids = filters.genres.map(g => genreIds[g]).filter((id): id is number => id != null);
    if (ids.length > 0) params.push(`with_genres=${ids.join(',')}`);
  }

  if (filters?.year) {
    const [fromMonth, toMonth] = filters.season ? SEASON_MONTHS[filters.season] : [1, 12];
    const lastDay = new Date(filters.year, toMonth, 0).getDate();
    const dateField = mediaType === 'series' ? 'first_air_date' : 'primary_release_date';
    params.push(`${dateField}.gte=${filters.year}-${String(fromMonth).padStart(2, '0')}-01`);
    params.push(`${dateField}.lte=${filters.year}-${String(toMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`);
  }

  return params.join('&');
}

function hasActiveFilters(filters?: SearchFilters): boolean {
  return !!(filters?.year || filters?.genres?.length);
}

// No text query — TMDB's own curated "top rated" endpoints, used when the
// search box is empty so a type tab isn't just blank until you type
// something. Switches to /discover instead whenever a season/year/genre
// filter is active, since /top_rated takes no filter params of its own.
export const topRatedMovies = (signal: AbortSignal, page = 1, filters?: SearchFilters) =>
  hasActiveFilters(filters)
    ? fetchTmdbPage('discover/movie', discoverParamsFromFilters('movie', filters), 'movie', signal, page)
    : fetchTmdbPage('movie/top_rated', '', 'movie', signal, page);

export const topRatedSeries = (signal: AbortSignal, page = 1, filters?: SearchFilters) =>
  hasActiveFilters(filters)
    ? fetchTmdbPage('discover/tv', discoverParamsFromFilters('series', filters), 'series', signal, page)
    : fetchTmdbPage('tv/top_rated', '', 'series', signal, page);

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
