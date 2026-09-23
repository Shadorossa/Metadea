import { API_URL } from '../../api/urls';
import { igdbSearch, igdbImageUrl } from '../../tauri/igdb';
import { isTauri } from '../../tauri/bridge';
import { readEnvConfig, type EnvConfig } from '../../tauri/env';
import type { MediaType, SearchResult, SearchPage, SearchFilters } from '../types';
import { cleanEditionTitle } from '../../media/title-utils';
import { unixToDateParts } from '../../media/mappers/mapper-utils';
import { MissingApiKeyError } from '../errors';

// ── Untrusted-JSON guards ─────────────────────────────────────────────────────
// igdbSearch's IgdbGame[] is a compile-time promise only — the JSON igdb.rs
// forwards is whatever IGDB sent. Each row is narrowed ONCE by parseIgdbGame
// (skipped, not thrown on, when it lacks the id/name every result needs) and
// mapped assertion-free from there.

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

// Only the IgdbGame fields a search result reads.
interface IgdbSearchRow {
  id: number;
  name: string;
  cover?: { image_id: string };
  first_release_date?: number;
  rating?: number;
  category?: number;
  genres?: { name: string }[];
}

function parseIgdbGame(raw: unknown): IgdbSearchRow | null {
  if (!isRecord(raw)) return null;
  const id = optionalNumber(raw.id);
  if (id === undefined || typeof raw.name !== 'string') return null;
  const coverImageId = isRecord(raw.cover) && typeof raw.cover.image_id === 'string' ? raw.cover.image_id : undefined;
  return {
    id,
    name: raw.name,
    cover: coverImageId ? { image_id: coverImageId } : undefined,
    first_release_date: optionalNumber(raw.first_release_date),
    rating: optionalNumber(raw.rating),
    category: optionalNumber(raw.category),
    genres: Array.isArray(raw.genres)
      ? raw.genres.flatMap(genre => (isRecord(genre) && typeof genre.name === 'string' ? [{ name: genre.name }] : []))
      : undefined,
  };
}

function parseIgdbGames(rows: unknown): IgdbSearchRow[] {
  return (Array.isArray(rows) ? rows : []).map(parseIgdbGame).filter((game): game is IgdbSearchRow => game !== null);
}

function mapIgdbGame(game: IgdbSearchRow, mediaType: MediaType, format: string): SearchResult {
  const dateParts = game.first_release_date ? unixToDateParts(game.first_release_date) : null;
  const coverUrl = game.cover?.image_id ? igdbImageUrl(game.cover.image_id, 'cover_big') : null;
  return {
    externalId:   `${mediaType}:${game.id}`,
    type:         mediaType,
    format,
    source:       'igdb',
    titleMain:    cleanEditionTitle(game.name),
    titleRomaji:  null,
    titleNative:  null,
    coverUrl,
    releaseYear:  dateParts?.year ?? null,
    releaseMonth: dateParts?.month ?? null,
    releaseDay:   dateParts?.day ?? null,
    scoreGlobal:  game.rating != null ? Math.round(game.rating) / 10 : null,
    genres:       game.genres?.map(genre => genre.name) ?? [],
  };
}

// Mirrors igdb_genre_id in igdb.rs (same source, IGDB's own stable genre
// taxonomy) — keep both lists in sync by hand if it ever changes. Rust maps
// name -> id for the `where genres = (...)` filter; this side only needs
// the names themselves, for the filter's own checkbox list.
export const IGDB_GENRES = [
  'Point-and-click', 'Fighting', 'Shooter', 'Music', 'Platform', 'Puzzle',
  'Racing', 'Real Time Strategy (RTS)', 'Role-playing (RPG)', 'Simulator',
  'Sport', 'Strategy', 'Turn-based strategy (TBS)', 'Tactical',
  "Hack and slash/Beat 'em up", 'Quiz/Trivia', 'Pinball', 'Adventure',
  'Indie', 'Arcade', 'Visual Novel', 'Card & Board Game', 'MOBA',
];

export async function searchGames(
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
  page = 1,
  filters?: SearchFilters,
): Promise<SearchPage> {
  if (isTauri()) {
    return searchGamesLocal(searchQuery, mediaType, signal, page, filters);
  }

  const url = `${API_URL}/api/search/games?q=${encodeURIComponent(searchQuery)}&type=${mediaType}&page=${page}`;
  const response = await fetch(url, { signal });
  if (!response.ok) return { results: [], hasMore: false };
  const data = await response.json() as { results?: SearchResult[]; hasMore?: boolean };
  return { results: Array.isArray(data.results) ? data.results : [], hasMore: data.hasMore === true };
}

// Shared by searchGameBundles/searchGameExpandedEditions/searchGameRemasters —
// live IGDB search restricted to specific categories plain search
// deliberately excludes (bundles, expanded editions, remasters, ...).
// mediaType defaults to 'game' but the caller can pass 'vnovel' when the
// entry being edited is itself a visual novel — a remaster/remake/expanded
// edition of a VN is still a VN (being a remaster doesn't change enough
// about a work to justify a different type), so it needs the "vnovel:"
// id prefix and type from the start, not "game:" corrected after the fact.
async function searchGamesByCategories(
  searchQuery: string,
  signal: AbortSignal,
  page: number,
  categories: number[],
  format: string,
  bundlesOnlyQueryParam: string,
  mediaType: MediaType = 'game',
): Promise<SearchPage> {
  if (isTauri()) {
    const cfg = await readEnvConfig().catch((): EnvConfig => ({}));
    if (!cfg.igdb_client_id || !cfg.igdb_client_secret) return { results: [], hasMore: false };

    let pageResult;
    try {
      pageResult = await igdbSearch(searchQuery, false, page, categories);
    } catch {
      return { results: [], hasMore: false };
    }

    const results = parseIgdbGames(pageResult.games).map(game =>
      mapIgdbGame(game, mediaType, format || (game.category === 8 ? 'REMAKE' : game.category === 9 ? 'REMASTER' : 'GAME')),
    );

    return { results, hasMore: pageResult.hasMore };
  }

  const url = `${API_URL}/api/search/games?q=${encodeURIComponent(searchQuery)}&type=${mediaType}&page=${page}&${bundlesOnlyQueryParam}=true`;
  const response = await fetch(url, { signal });
  if (!response.ok) return { results: [], hasMore: false };
  const data = await response.json() as { results?: SearchResult[]; hasMore?: boolean };
  return { results: Array.isArray(data.results) ? data.results : [], hasMore: data.hasMore === true };
}

// IGDB category 3 (bundle) — the "Bundled In" relation picker.
export async function searchGameBundles(searchQuery: string, signal: AbortSignal, page = 1, mediaType: MediaType = 'game'): Promise<SearchPage> {
  return searchGamesByCategories(searchQuery, signal, page, [3], 'BUNDLE', 'bundlesOnly', mediaType);
}

// IGDB category 10 (expanded_game) — the "Contains" relation picker.
export async function searchGameExpandedEditions(searchQuery: string, signal: AbortSignal, page = 1, mediaType: MediaType = 'game'): Promise<SearchPage> {
  return searchGamesByCategories(searchQuery, signal, page, [10], 'EXPANDED_GAME', 'expandedOnly', mediaType);
}

// IGDB categories 8 (remake) & 9 (remaster) — the "Contains" relation picker for remasters.
export async function searchGameRemasters(searchQuery: string, signal: AbortSignal, page = 1, mediaType: MediaType = 'game'): Promise<SearchPage> {
  return searchGamesByCategories(searchQuery, signal, page, [8, 9], 'REMASTER', 'remastersOnly', mediaType);
}

async function searchGamesLocal(
  searchQuery: string,
  mediaType: MediaType,
  _signal: AbortSignal,
  page: number,
  filters?: SearchFilters,
): Promise<SearchPage> {
  const cfg = await readEnvConfig().catch((): EnvConfig => ({}));
  if (!cfg.igdb_client_id || !cfg.igdb_client_secret) {
    throw new MissingApiKeyError(['igdb']);
  }

  let pageResult;
  try {
    pageResult = await igdbSearch(searchQuery, mediaType === 'vnovel', page, undefined, {
      filterYear: filters?.year,
      filterSeason: filters?.season,
      filterGenres: filters?.genres,
    });
  } catch (e) {
    throw new Error(typeof e === 'string' ? e : 'IGDB error');
  }

  const format = mediaType === 'vnovel' ? 'VISUAL_NOVEL' : 'GAME';
  const results = parseIgdbGames(pageResult.games).map(game => mapIgdbGame(game, mediaType, format));

  return { results, hasMore: pageResult.hasMore };
}
