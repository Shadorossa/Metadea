import { readSearchEnvConfig } from '../env-config-read';
import type { MediaType, SearchResult, SearchPage, SearchFilters } from '../types';
import { SEASON_MONTHS } from '../types';
import { API_ENDPOINTS } from '../../api/endpoints';
import { fetchJson } from '../../api/client';
import { MissingApiKeyError } from '../errors';

// ── Untrusted-JSON guards ─────────────────────────────────────────────────────
// The response interfaces below describe what TMDB documents, not what a
// given payload is guaranteed to carry. Each list mapper narrows its rows ONCE
// through a parse*Row guard (a row that fails is skipped, never thrown on)
// and is written assertion-free from there.

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function rowsOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined;
}

function numberList(value: unknown): number[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : undefined;
}

function nonNull<T>(value: T | null): value is T {
  return value !== null;
}

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

function parseTmdbMovie(raw: unknown): TmdbMovie | null {
  if (!isRecord(raw)) return null;
  const id = optionalNumber(raw.id);
  if (id === undefined) return null;
  return {
    id,
    title: optionalString(raw.title),
    name: optionalString(raw.name),
    poster_path: optionalString(raw.poster_path) ?? null,
    release_date: optionalString(raw.release_date),
    first_air_date: optionalString(raw.first_air_date),
    vote_average: optionalNumber(raw.vote_average) ?? 0,
    genre_ids: numberList(raw.genre_ids),
    original_language: optionalString(raw.original_language),
    origin_country: stringList(raw.origin_country),
  };
}

// TMDB genre id for "Animation". Japanese-language animation overlaps with
// AniList's anime catalog, so it's excluded here to avoid duplicate entries
// across the two providers.
const TMDB_GENRE_ANIMATION = 16;

function isAnime(movie: TmdbMovie): boolean {
  return movie.original_language === 'ja' && !!movie.genre_ids?.includes(TMDB_GENRE_ANIMATION);
}

interface TmdbPageResponse {
  results?: unknown[];
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
  /** Per-season summary, always present on the detail response (no
   *  append_to_response needed) — season_number 0 is specials, same
   *  convention as fetchTmdbEpisodes. Used by anime-tmdb-match.ts to line up
   *  TMDB's own season split against an AniList prequel/sequel chain. */
  seasons?: TmdbSeasonSummary[];
}

export interface TmdbSeasonSummary {
  season_number: number;
  episode_count?: number;
  air_date?: string | null;
  name?: string;
  // Already present on TMDB's own raw response (no extra request needed) —
  // just wasn't declared here before, since nothing read it yet.
  poster_path?: string | null;
}

export function buildPosterUrl(posterPath: string | null): string | null {
  return posterPath ? API_ENDPOINTS.TMDB_IMAGE(posterPath) : null;
}

export function parseDateParts(dateString?: string): { year: number | null; month: number | null; day: number | null } {
  if (!dateString) return { year: null, month: null, day: null };
  // TMDB dates are "YYYY-MM-DD" with no time component — JS parses them as UTC midnight,
  // so local-time methods (getFullYear etc.) can return the previous day in negative offsets.
  const date = new Date(dateString);
  // A string TMDB shouldn't send (e.g. "unknown") parses to an Invalid Date —
  // report "no date" rather than three NaNs.
  if (Number.isNaN(date.getTime())) return { year: null, month: null, day: null };
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
    const cfg = await readSearchEnvConfig();
    accessToken = cfg.tmdb_access_token ?? '';
    apiKey = cfg.tmdb_api_key ?? '';
  } catch {
    // Not in Tauri or config doesn't exist
  }

  if (!accessToken && !apiKey) return null;
  return { accessToken, apiKey };
}

// Always English, regardless of the app's own UI language — every other
// provider (AniList's romaji/english title fields, IGDB, ComicVine, Open
// Library) returns/stores data in English no matter what language Metadea's
// own interface is in, so title/overview/etc. coming back from TMDB
// specifically switching to Spanish whenever the UI is in Spanish was the
// one inconsistent source: whatever got saved to the catalog (title_main,
// synopsis, ...) depended on which language the searcher happened to have
// the app in at the time, not a fixed, predictable language like every
// other provider.
export function tmdbLocale(): string {
  return 'en-US';
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
      ...rowsOf(data.results)
        .map(parseTmdbMovie)
        .filter(nonNull)
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

// Bare TMDB tv search results (just id/name/first_air_date), deliberately
// NOT filtered through isAnime() the way searchSeries/fetchTmdbPage is —
// that filter exists so the app's own search UI doesn't show a Japanese
// animation twice (once from TMDB, once from AniList), but anime-tmdb-
// match.ts is searching TMDB specifically to find an anime's own TMDB
// listing, so filtering anime out would defeat the point (this was
// silently dropping every real candidate, e.g. Gintama, id 57041). One
// TMDB page (20 results) is always enough for the top-5 candidates the
// caller actually checks.
export interface TmdbTvSearchHit {
  id: number;
  name?: string;
  first_air_date?: string;
  poster_path?: string | null;
}

export async function searchTvIncludingAnime(query: string, signal: AbortSignal): Promise<TmdbTvSearchHit[]> {
  const auth = await getTmdbAuth();
  if (!auth) return [];

  const headers: Record<string, string> = {};
  if (auth.accessToken) headers['Authorization'] = `Bearer ${auth.accessToken}`;

  let url = `${API_ENDPOINTS.TMDB}/search/tv?query=${encodeURIComponent(query)}&page=1&language=${tmdbLocale()}`;
  if (auth.apiKey) url += `&api_key=${encodeURIComponent(auth.apiKey)}`;

  const data = await fetchJson<TmdbPageResponse>(url, { signal, headers }).catch(() => null);
  return rowsOf(data?.results).map(parseTvSearchHit).filter(nonNull);
}

function parseTvSearchHit(raw: unknown): TmdbTvSearchHit | null {
  if (!isRecord(raw)) return null;
  const id = optionalNumber(raw.id);
  if (id === undefined) return null;
  return {
    id,
    name: optionalString(raw.name),
    first_air_date: optionalString(raw.first_air_date),
    poster_path: raw.poster_path === null ? null : optionalString(raw.poster_path),
  };
}

export interface TmdbPersonSearchHit {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department?: string;
  popularity?: number;
}

function normalizePersonName(name: string): string {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export async function searchTmdbPeople(query: string, signal?: AbortSignal): Promise<TmdbPersonSearchHit[]> {
  const clean = query.trim();
  if (!clean) return [];

  const auth = await getTmdbAuth();
  if (!auth) return [];

  const headers: Record<string, string> = {};
  if (auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;
  let url = `${API_ENDPOINTS.TMDB}/search/person?query=${encodeURIComponent(clean)}&page=1&language=${tmdbLocale()}`;
  if (auth.apiKey) url += `&api_key=${encodeURIComponent(auth.apiKey)}`;

  const data = await fetchJson<{ results?: unknown[] }>(url, { headers, signal }).catch(() => null);
  return rowsOf(data?.results).map(parsePersonSearchHit).filter(nonNull);
}

function parsePersonSearchHit(raw: unknown): TmdbPersonSearchHit | null {
  if (!isRecord(raw)) return null;
  const id = optionalNumber(raw.id);
  const name = optionalString(raw.name);
  if (id === undefined || name === undefined) return null;
  return {
    id,
    name,
    profile_path: optionalString(raw.profile_path) ?? null,
    known_for_department: optionalString(raw.known_for_department),
    popularity: optionalNumber(raw.popularity),
  };
}

/** Exact-name fallback for staff/voice actors not present in AniList. */
export async function findTmdbPersonExactMatch(
  query: string,
  signal?: AbortSignal,
): Promise<TmdbPersonSearchHit | null> {
  const clean = query.trim();
  if (!clean) return null;

  const normalizedQuery = normalizePersonName(clean);
  return (await searchTmdbPeople(clean, signal))
    .filter(person => normalizePersonName(person.name) === normalizedQuery)
    .sort((a, b) => {
      const actingDifference = Number(b.known_for_department === 'Acting') - Number(a.known_for_department === 'Acting');
      return actingDifference || (b.popularity ?? 0) - (a.popularity ?? 0);
    })[0] ?? null;
}

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

interface TmdbSeasonEpisode {
  episode_number: number;
  name?: string;
  still_path: string | null;
}

interface TmdbSeasonResponse {
  episodes?: unknown[];
}

function parseSeasonEpisode(raw: unknown): TmdbSeasonEpisode | null {
  if (!isRecord(raw)) return null;
  const episodeNumber = optionalNumber(raw.episode_number);
  if (episodeNumber === undefined) return null;
  return {
    episode_number: episodeNumber,
    name: optionalString(raw.name),
    still_path: optionalString(raw.still_path) ?? null,
  };
}

// A season that failed to fetch and one with no usable episodes are the same
// thing to every reader below: an empty list.
function episodesOf(season: TmdbSeasonResponse | null): TmdbSeasonEpisode[] {
  return rowsOf(season?.episodes).map(parseSeasonEpisode).filter(nonNull);
}

export interface TmdbEpisodeSummary {
  season_number:          number;
  episode_number:         number;
  season_episode_number?: number;
  name:                   string | null;
  cover_url:              string | null;
}

function isInformativeEpisodeName(name?: string | null): boolean {
  const value = name?.trim();
  return !!value && !/^(?:episode|episodio|ep)\s*#?\d+(?:\s*\/\s*\d+)?$/i.test(value);
}

// One request per season (TMDB has no single "all episodes" endpoint) — runs
// in parallel since each season's fetch is independent.
export async function fetchTmdbEpisodesForSeasons(
  tmdbId: number,
  seasonNumbers: number[],
  fallbackLanguages: string[] = [],
): Promise<TmdbEpisodeSummary[]> {
  const auth = await getTmdbAuth();
  if (!auth || seasonNumbers.length === 0) return [];

  const headers: Record<string, string> = {};
  if (auth.accessToken) headers['Authorization'] = `Bearer ${auth.accessToken}`;

  const buildUrl = (seasonNumber: number, language = tmdbLocale()) => {
    let url = `${API_ENDPOINTS.TMDB}/tv/${tmdbId}/season/${seasonNumber}?language=${language}`;
    if (auth.apiKey) url += `&api_key=${encodeURIComponent(auth.apiKey)}`;
    return url;
  };

  const fetchSeasons = (numbers: number[], language: string) => Promise.all(
    numbers.map(seasonNumber =>
      fetchJson<TmdbSeasonResponse>(buildUrl(seasonNumber, language), { headers })
        .then(season => ({ seasonNumber, episodes: episodesOf(season) }))
        .catch(() => ({ seasonNumber, episodes: [] as TmdbSeasonEpisode[] })),
    ),
  );

  const seasons = await fetchSeasons(seasonNumbers, tmdbLocale());
  const namesBySeason = new Map(seasons.map(({ seasonNumber, episodes }) => [
    seasonNumber,
    new Map(episodes.map(ep => [ep.episode_number, ep.name?.trim() || null])),
  ]));

  // Names use this precedence: English, application language, then the
  // source series' original language. Later translations only fill titles
  // still missing or generic after earlier fallbacks.
  for (const language of [...new Set(fallbackLanguages)]) {
    if (!language || language === tmdbLocale()) continue;
    const missingSeasonNumbers = seasons
      .filter(({ seasonNumber, episodes }) => {
        const names = namesBySeason.get(seasonNumber);
        return episodes.some(ep => !isInformativeEpisodeName(names?.get(ep.episode_number)));
      })
      .map(({ seasonNumber }) => seasonNumber);
    if (missingSeasonNumbers.length === 0) break;

    const translatedSeasons = await fetchSeasons(missingSeasonNumbers, language);
    for (const { seasonNumber, episodes } of translatedSeasons) {
      const preferredNames = namesBySeason.get(seasonNumber);
      if (!preferredNames) continue;
      for (const episode of episodes) {
        const translatedName = episode.name?.trim();
        if (!translatedName) continue;
        const currentName = preferredNames.get(episode.episode_number);
        if (!isInformativeEpisodeName(currentName) && isInformativeEpisodeName(translatedName)) {
          preferredNames.set(episode.episode_number, translatedName);
        }
      }
    }
  }

  /* Keep preferred-language titles and use subsequent locales only where
   * that episode still has no informative title. */
  const episodes: TmdbEpisodeSummary[] = [];
  for (const { seasonNumber, episodes: seasonEpisodes } of seasons) {
    const names = namesBySeason.get(seasonNumber);
    seasonEpisodes.forEach((ep, idx) => {
      episodes.push({
        season_number:         seasonNumber,
        episode_number:        ep.episode_number,
        season_episode_number: idx + 1,
        name:                  names?.get(ep.episode_number) ?? null,
        cover_url:             buildPosterUrl(ep.still_path),
      });
    });
  }
  return episodes;
}

// Season 0 (specials) through numberOfSeasons, TMDB's own contiguous
// numbering — the common case (a series with no AniList season-split to
// worry about). Season 0 is included: TMDB numbers it like any other
// season, and the media page's episode table doesn't need to treat it
// differently. numberOfSeasons is the count of regular seasons (1-N),
// so we add 1 to include season 0 (specials).
export async function fetchTmdbEpisodes(tmdbId: number, numberOfSeasons: number): Promise<TmdbEpisodeSummary[]> {
  if (numberOfSeasons <= 0) return [];
  return fetchTmdbEpisodesForSeasons(tmdbId, Array.from({ length: numberOfSeasons + 1 }, (_, i) => i));
}
