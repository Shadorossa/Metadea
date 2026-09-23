import { invoke, tauriTry, tauriCmd, tauriRun, isTauri, waitForTauriBridge } from './bridge';

export interface IgdbNamed { id: number; name: string }
export interface IgdbImage { id: number; image_id: string }
export interface IgdbCover { id: number; image_id: string }
export interface IgdbInvolvedCompany {
  id:         number;
  company?:   IgdbNamed & { logo?: { image_id: string } };
  developer?: boolean;
  publisher?: boolean;
}
export interface IgdbGame extends Record<string, unknown> {
  id:                   number;
  name:                 string;
  url?:                 string;
  summary?:             string;
  banner_image_id?:     string | null;
  cover?:               IgdbCover;
  screenshots?:         IgdbImage[];
  artworks?:            IgdbImage[];
  genres?:              IgdbNamed[];
  involved_companies?:  IgdbInvolvedCompany[];
  first_release_date?:  number; // unix timestamp
  rating?:              number;
  total_rating?:        number;
  rating_count?:        number;
  hypes?:               number; // pre-release "anticipation" follow count - used as a popularity proxy
  category?:            number;
  status?:              number;
  game_type?:           number;
  platforms?:           IgdbNamed[];
  alternative_names?:   { name: string; comment?: string }[];
  store_links?:         { platform: string; url: string }[] | null;
  parent_game?:         { id: number; name: string; cover?: IgdbCover; first_release_date?: number; game_type?: number; is_vn?: boolean };
  version_parent?:      { id: number; name: string; cover?: IgdbCover; first_release_date?: number; game_type?: number; is_vn?: boolean };
  remakes?:             IgdbGame[];
  remasters?:           IgdbGame[];
  expansions?:          IgdbGame[];
  standalone_expansions?: IgdbGame[];
  expanded_games?:      IgdbGame[];
  ports?:               IgdbGame[];
  forks?:               IgdbGame[];
}

export function igdbImageUrl(imageId: string, size = 'screenshot_big'): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

export interface IgdbSearchPage {
  games: IgdbGame[];
  hasMore: boolean;
}

export interface IgdbSearchFilters {
  filterYear?: number;
  filterSeason?: string;
  filterGenres?: string[];
}

export async function igdbSearch(
  query: string,
  isVisualNovel = false,
  page = 1,
  onlyCategories?: number[],
  filters?: IgdbSearchFilters,
): Promise<IgdbSearchPage> {
  return invoke<IgdbSearchPage>('igdb_search', {
    query, isVisualNovel, page, onlyCategories,
    filterYear: filters?.filterYear,
    filterSeason: filters?.filterSeason,
    filterGenres: filters?.filterGenres,
  });
}

export async function igdbSearchUnfiltered(query: string, page = 1): Promise<IgdbSearchPage> {
  return invoke<IgdbSearchPage>('igdb_search_unfiltered', { query, page });
}

// Games releasing between the two unix timestamps — single request. Silently
// returns [] if IGDB isn't configured or the call fails (tauriCmd fallback),
// so the Home calendar's "General" view can call this unconditionally.
export async function igdbUpcomingReleases(startUnix: number, endUnix: number): Promise<IgdbGame[]> {
  return tauriCmd<IgdbGame[]>('igdb_upcoming_releases', [], { startUnix, endUnix });
}

export async function igdbGetGameDetail(igdbId: number): Promise<IgdbGame | null> {
  return tauriTry<IgdbGame | null>('igdb_get_game_detail', null, { igdbId });
}

/** All IGDB cover variants, including localized covers, for one game. */
export async function igdbGetLocalizedCovers(igdbId: number): Promise<string[]> {
  return tauriCmd<string[]>('igdb_get_localized_covers', [], { igdbId });
}

export async function igdbGetBaseGames(igdbId: number, relationField: 'remakes' | 'remasters'): Promise<unknown[] | null> {
  return tauriTry<unknown[] | null>('igdb_get_base_games', null, { igdbId, relationField });
}

export async function igdbGetRelationGraph(rootId: number): Promise<unknown[]> {
  return tauriTry<unknown[]>('igdb_get_relation_graph', [], { rootId });
}

// romPlatform (LocalGame.rom_platform) restricts the IGDB name search to
// that console and records the automatic match in local_game_links.
export async function igdbGetCoverBySteamId(appId: string, gameName: string, launcher: string, romPlatform?: string | null): Promise<string | null> {
  return tauriCmd<string | null>('igdb_get_cover_by_steam_id', null, { appId, gameName, launcher, romPlatform: romPlatform ?? null });
}

// ── Batched metadata fetch ("Obtener metadatos") ───────────────────────────
// One command for the whole pending list instead of one
// igdbGetCoverBySteamId per game — see igdb/batch.rs for how the Steam-id,
// by-id and name-search stages are grouped ten games per request, and the
// not-found memo that keeps unmatched games from hitting IGDB every scan.

export interface IgdbBatchGameRequest {
  app_id: string;
  game_name: string;
  launcher: string;
  rom_platform?: string | null;
}

export interface IgdbBatchGameResult {
  app_id: string;
  status: 'cached' | 'done' | 'not_found' | 'skipped' | 'error' | 'cancelled';
  cover_path: string | null;
  error: string | null;
}

export interface MetadataBatchProgress {
  total: number;
  current: number;
  current_name: string;
}

// Straight `invoke`, not tauriCmd: an empty fallback here read as "nothing
// to do" and the modal closed without a word; outside Tauri this rejects
// instead, and runMetadataFetch shows the error. retryNotFound ignores the
// not-found memo ("Retry skipped games").
export async function igdbFetchMetadataBatch(games: IgdbBatchGameRequest[], retryNotFound = false): Promise<IgdbBatchGameResult[]> {
  if (games.length === 0) return [];
  return invoke<IgdbBatchGameResult[]>('igdb_fetch_metadata_batch', { games, retryNotFound });
}

export async function igdbCancelMetadataBatch(): Promise<void> {
  return tauriRun('igdb_cancel_metadata_batch');
}

// Progress events the batch emits as each game finishes. Returns an
// unlisten function (no-op outside Tauri), same shape as
// listenGameSessionEnded.
export async function listenMetadataProgress(callback: (progress: MetadataBatchProgress) => void): Promise<() => void> {
  if (!isTauri() && !(await waitForTauriBridge())) return () => {};
  const { listen } = await import(/* @vite-ignore */ '@tauri-apps/api/event');
  return listen<MetadataBatchProgress>('local-metadata-progress', event => callback(event.payload));
}

export interface IgdbCandidate {
  id:          number;
  name:        string;
  year:        number;
  cover_url:   string;
  developer:   string;
  category?:   number | null;
  externalId?: string;
  type?:       string;
  source?:     'database' | 'igdb';
}

// romPlatform pre-filters the candidates to a scanned ROM's own console.
export async function igdbSearchCandidates(gameName: string, romPlatform?: string | null): Promise<IgdbCandidate[]> {
  return tauriCmd<IgdbCandidate[]>('igdb_search_candidates', [], { gameName, romPlatform: romPlatform ?? null });
}

export async function igdbForceByIgdbId(appId: string, gameName: string, igdbId: number): Promise<string> {
  return tauriCmd<string>('igdb_force_by_igdb_id', '', { appId, gameName, igdbId });
}
