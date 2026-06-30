const isTauri = (): boolean => {
  if (typeof window === 'undefined') return false;
  if ('__TAURI_IPC__' in window) return true;
  if ('__TAURI__' in window) return true;
  return false;
};

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    console.warn(`[Tauri] "${cmd}" called outside Tauri`);
    throw new Error('Tauri not available');
  }
  const tauri = (window as any).__TAURI__;
  if (tauri?.core?.invoke) return tauri.core.invoke(cmd, args);
  const { invoke: tauriInvoke } = await import(/* @vite-ignore */ '@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

// No-op when not in Tauri
async function tauriRun(cmd: string, args?: Record<string, unknown>): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>(cmd, args);
}

// Returns fallback when not in Tauri
async function tauriCmd<T>(cmd: string, fallback: T, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return fallback;
  return invoke<T>(cmd, args);
}

// Returns fallback when not in Tauri or on error
async function tauriTry<T>(cmd: string, fallback: T, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return fallback;
  try { return await invoke<T>(cmd, args); } catch { return fallback; }
}

// Read a JSON-string file from Tauri, or localStorage in browser
async function readStoredJson<T>(cmd: string, localKey: string, fallback: T): Promise<T> {
  if (!isTauri()) {
    try {
      const s = localStorage.getItem(localKey);
      return s ? JSON.parse(s) : fallback;
    } catch { return fallback; }
  }
  try { return JSON.parse(await invoke<string>(cmd)); } catch { return fallback; }
}

// Write a value as a JSON-string file to Tauri, or localStorage in browser
async function writeStoredJson<T>(cmd: string, localKey: string, value: T, argKey = 'content'): Promise<void> {
  const content = JSON.stringify(value, null, 2);
  if (!isTauri()) { localStorage.setItem(localKey, content); return; }
  return invoke<void>(cmd, { [argKey]: content });
}

export async function pathToDataUrl(filePath: string): Promise<string | null> {
  return tauriTry<string | null>('file_to_data_url', null, { filePath });
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthSession {
  token:    string;
  username: string;
}

export async function storeAuthToken(token: string, username: string): Promise<void> {
  localStorage.setItem('auth_token',    token);
  localStorage.setItem('auth_username', username);
  if (isTauri()) await invoke('store_auth_token', { token, username });
}

export async function getAuthToken(): Promise<AuthSession | null> {
  const token    = localStorage.getItem('auth_token');
  const username = localStorage.getItem('auth_username') ?? '';
  if (token) return { token, username };
  if (isTauri()) {
    try {
      const session = await invoke<AuthSession | null>('get_auth_token');
      if (session) {
        localStorage.setItem('auth_token',    session.token);
        localStorage.setItem('auth_username', session.username);
      }
      return session;
    } catch { return null; }
  }
  return null;
}

export async function clearAuthToken(): Promise<void> {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_username');
  if (isTauri()) await invoke('clear_auth_token');
}

// ─── Database ────────────────────────────────────────────────────────────────

interface LibraryItem {
  id?:               number;
  external_id:       string;
  item_type:         string;
  rating?:           number;
  status?:           string;
  progress_minutes?: number;
  created_at?:       string;
  updated_at?:       string;
}

export async function initTauriDatabase(): Promise<string> {
  if (!isTauri()) return 'not-tauri';
  const tauri   = (window as any).__TAURI__;
  const dataDir = tauri?.path?.appDataDir ? await tauri.path.appDataDir() : 'unknown';
  return invoke<string>('init_database', { app_data_dir: dataDir });
}

export async function saveLibraryItem(
  external_id: string,
  item_type:   string,
  options?:    { rating?: number; status?: string },
): Promise<string> {
  return invoke<string>('save_library_item', {
    external_id, item_type, rating: options?.rating, status: options?.status,
  });
}

export async function getLibraryItems(): Promise<LibraryItem[]> {
  return invoke<LibraryItem[]>('get_library_items');
}

export async function getLibraryStats(): Promise<{ total: number; by_type: Record<string, number> }> {
  return invoke<{ total: number; by_type: Record<string, number> }>('get_library_stats');
}

// ─── Local Library ────────────────────────────────────────────────────────────

export interface LocalGame {
  name:              string;
  launcher:          'steam' | 'epic' | 'xbox' | 'gog' | 'ea' | 'local';
  app_id?:           string;
  install_path?:     string;
  playtime_minutes?: number;
  last_played?:      number;
  installed?:        boolean;
}

export interface SteamOwnedGame {
  appid:              number;
  name:               string;
  playtime_forever:   number;
  rtime_last_played?: number;
  img_icon_url?:      string;
}

export interface LocalFolderEntry {
  name:         string;
  is_dir:       boolean;
  size:         number;
  child_count?: number;
}

export interface SavedFolder {
  path:  string;
  label: string;
}

export async function pickFolder(): Promise<string | null> {
  return tauriCmd<string | null>('pick_folder', null);
}

export async function scanFolderContents(path: string): Promise<LocalFolderEntry[]> {
  return tauriCmd<LocalFolderEntry[]>('scan_folder_contents', [], { path });
}

export async function scanAllGames(): Promise<LocalGame[]> {
  return tauriCmd<LocalGame[]>('scan_all_games', []);
}

export async function getLocalFolders(): Promise<SavedFolder[]> {
  if (!isTauri()) {
    const stored = localStorage.getItem('local_folders');
    return stored ? JSON.parse(stored) : [];
  }
  return invoke<SavedFolder[]>('get_local_folders');
}

export async function saveLocalFolders(folders: SavedFolder[]): Promise<void> {
  if (!isTauri()) { localStorage.setItem('local_folders', JSON.stringify(folders)); return; }
  return invoke<void>('save_local_folders', { folders_json: JSON.stringify(folders) });
}

// ─── Category routes ──────────────────────────────────────────────────────────

export async function readRoutes(): Promise<Record<string, string>> {
  return readStoredJson<Record<string, string>>('read_routes', 'category_routes', {});
}

export async function writeRoutes(routes: Record<string, string>): Promise<void> {
  return writeStoredJson('write_routes', 'category_routes', routes, 'routes_json');
}

// ─── Env config ───────────────────────────────────────────────────────────────

export interface EnvConfig {
  igdb_client_id?:     string;
  igdb_client_secret?: string;
  steam_api_key?:      string;
  tmdb_access_token?:  string;
  tmdb_api_key?:       string;
}

export async function readEnvConfig(): Promise<EnvConfig> {
  if (isTauri()) {
    try {
      const cfg = await invoke<EnvConfig>('read_env_config');
      localStorage.setItem('env_config', JSON.stringify(cfg));
      return cfg;
    } catch { /* fall through */ }
  }
  const stored = localStorage.getItem('env_config');
  if (stored) return JSON.parse(stored);
  return { igdb_client_id: undefined, igdb_client_secret: undefined };
}

export async function writeEnvConfig(config: EnvConfig): Promise<void> {
  localStorage.setItem('env_config', JSON.stringify(config));
  if (isTauri()) {
    try {
      await invoke<void>('write_env_config', { config });
    } catch (err) {
      throw new Error(`write_env_config failed: ${err}`);
    }
  }
}

// ─── User Library (JSON files) ───────────────────────────────────────────────

export interface LibraryEntry {
  id:                string;
  user_id:           string;
  external_id:       string;
  type:              string;
  status:            string | null;
  rating:            number | null;
  progress:          number;
  minutes_spent:     number;
  is_favorite:       number;
  is_platinum:       number;
  tags:              string[] | null;
  notes:             string | null;
  added_at:          string | null;
  updated_at:        string | null;
  selected_platform: string | null;
  selected_version:  string | null;
  started_at:        string | null;
  finished_at:       string | null;
}

export async function saveLibraryEntry(entry: LibraryEntry): Promise<LibraryEntry> {
  if (!isTauri()) throw new Error('Tauri not available');
  return invoke<LibraryEntry>('save_library_entry', { entry });
}

export async function getLibraryEntry(externalId: string, entryType: string): Promise<LibraryEntry | null> {
  return tauriCmd<LibraryEntry | null>('get_library_entry', null, { externalId, entryType });
}

export async function deleteLibraryEntry(externalId: string, entryType: string): Promise<void> {
  return tauriRun('delete_library_entry', { externalId, entryType });
}

export async function getAllLibraryEntries(): Promise<LibraryEntry[]> {
  return tauriCmd<LibraryEntry[]>('get_all_library_entries', []);
}

export async function readMonthlyHistory(): Promise<Record<string, string[]>> {
  return readStoredJson<Record<string, string[]>>('read_monthly_history', 'monthly_history', {});
}

export async function writeMonthlyHistory(history: Record<string, string[]>): Promise<void> {
  return writeStoredJson('write_monthly_history', 'monthly_history', history);
}

// ─── User Favorites ──────────────────────────────────────────────────────────

export async function readUserFavorites(): Promise<Record<string, string[]>> {
  return readStoredJson<Record<string, string[]>>('read_user_favorites', 'user_favorite', {});
}

export async function writeUserFavorites(favorites: Record<string, string[]>): Promise<void> {
  return writeStoredJson('write_user_favorites', 'user_favorite', favorites);
}

// ─── User Journey ───────────────────────────────────────────────────────────

export interface UserJourneyEvent {
  externalId:     string;
  type:           'start' | 'complete' | 'progress';
  progressStart?: number;
  progressEnd?:   number;
  mediaType:      string;
  timestamp:      string; // ISO String
}

export interface DayJourney {
  date:   string; // YYYY-MM-DD
  events: UserJourneyEvent[];
}

export async function readUserJourney(): Promise<DayJourney[]> {
  return readStoredJson<DayJourney[]>('read_user_journey', 'user_journey', []);
}

export async function writeUserJourney(journey: DayJourney[]): Promise<void> {
  return writeStoredJson('write_user_journey', 'user_journey', journey);
}

// ─── Media Catalog ────────────────────────────────────────────────────────────

export interface MediaCatalogEntry {
  id:                   string;
  external_id:          string;
  parent_id?:           string | null;
  type:                 string;
  format?:              string | null;
  source?:              string | null;
  title_main?:          string | null;
  title_romaji?:        string | null;
  title_native?:        string | null;
  synopsis?:            string | null;
  cover_url?:           string | null;
  banners_csv?:         string | null;
  release_year?:        number | null;
  release_month?:       number | null;
  release_day?:         number | null;
  time_length?:         number | null;
  status?:              string | null;
  score_global?:        number | null;
  favorites_count?:     number | null;
  ratings_count?:       number | null;
  total_count?:         number | null;
  total_count_2?:       number | null;
  genres_csv?:          string | null;
  genres_tag_csv?:      string | null;
  platforms_csv?:       string | null;
  companies_cache_csv?: string | null;
  last_synced_at?:      string | null;
  sync_failed_count?:   number | null;
  last_sync_error?:     string | null;
  created_at:           string;
  updated_at:           string;
}

export async function saveCatalogEntry(entry: MediaCatalogEntry): Promise<MediaCatalogEntry> {
  if (!isTauri()) throw new Error('Tauri not available');
  return invoke<MediaCatalogEntry>('save_catalog_entry', { entry });
}

export async function getCatalogEntry(externalId: string): Promise<MediaCatalogEntry | null> {
  return tauriCmd<MediaCatalogEntry | null>('get_catalog_entry', null, { externalId });
}

export async function deleteCatalogEntry(externalId: string): Promise<void> {
  return tauriRun('delete_catalog_entry', { externalId });
}

export async function getAllCatalogEntries(): Promise<MediaCatalogEntry[]> {
  return tauriCmd<MediaCatalogEntry[]>('get_all_catalog_entries', []);
}

export async function searchCatalog(query: string): Promise<MediaCatalogEntry[]> {
  return tauriCmd<MediaCatalogEntry[]>('search_catalog', [], { query });
}

// ─── IGDB ─────────────────────────────────────────────────────────────────────

export interface IgdbNamed { id: number; name: string }
export interface IgdbImage { id: number; image_id: string }
export interface IgdbCover { id: number; image_id: string }
export interface IgdbInvolvedCompany {
  id:         number;
  company?:   IgdbNamed;
  developer?: boolean;
  publisher?: boolean;
}
export interface IgdbGame {
  id:                   number;
  name:                 string;
  summary?:             string;
  cover?:               IgdbCover;
  screenshots?:         IgdbImage[];
  artworks?:            IgdbImage[];
  genres?:              IgdbNamed[];
  involved_companies?:  IgdbInvolvedCompany[];
  first_release_date?:  number; // unix timestamp
  rating?:              number;
  rating_count?:        number;
}

export function igdbImageUrl(imageId: string, size = 'screenshot_big'): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

export async function igdbSearch(query: string, isVisualNovel = false): Promise<IgdbGame[]> {
  return invoke<IgdbGame[]>('igdb_search', { query, isVisualNovel });
}

export async function igdbGetGameDetail(igdbId: number): Promise<Record<string, unknown> | null> {
  return tauriTry<Record<string, unknown> | null>('igdb_get_game_detail', null, { igdbId });
}

function steamLang(): string {
  const l = navigator.language;
  if (l.startsWith('es')) return 'spanish';
  if (l.startsWith('fr')) return 'french';
  if (l.startsWith('de')) return 'german';
  if (l.startsWith('pt')) return 'portuguese';
  if (l.startsWith('it')) return 'italian';
  if (l.startsWith('ru')) return 'russian';
  if (l.startsWith('zh')) return 'schinese';
  if (l.startsWith('ja')) return 'japanese';
  if (l.startsWith('ko')) return 'koreana';
  return 'english';
}

export async function igdbGetCoverBySteamId(appId: string, gameName: string): Promise<string | null> {
  return tauriCmd<string | null>('igdb_get_cover_by_steam_id', null, { appId, gameName });
}

export interface IgdbCandidate {
  id:        number;
  name:      string;
  year:      number;
  cover_url: string;
  developer: string;
}

export async function igdbSearchCandidates(gameName: string): Promise<IgdbCandidate[]> {
  return tauriCmd<IgdbCandidate[]>('igdb_search_candidates', [], { gameName });
}

export async function igdbForceByIgdbId(appId: string, gameName: string, igdbId: number): Promise<string> {
  return tauriCmd<string>('igdb_force_by_igdb_id', '', { appId, gameName, igdbId });
}

export interface MetaEntry {
  cover_path?:  string;
  banner_path?: string;
}

export async function readMetadataIndex(): Promise<Record<string, MetaEntry>> {
  return tauriCmd<Record<string, MetaEntry>>('read_metadata_index', {});
}

export interface GameInfo {
  app_id:       string;
  name:         string;
  igdb_id?:     number;
  summary?:     string;
  release_date?: number;
  rating?:      number;
  genres?:      string[];
  developers?:  string[];
  publishers?:  string[];
  how_long_to_beat?: {
    main_story_minutes?:    number;
    main_extra_minutes?:    number;
    completionist_minutes?: number;
  };
  last_fetched?: string;
}

export async function readGameInfo(appId: string): Promise<GameInfo | null> {
  if (!isTauri()) return null;
  try {
    const info = await invoke<GameInfo>('read_game_info', { appId });
    return info && Object.keys(info).length > 0 ? info : null;
  } catch { return null; }
}

// ─── Debug ────────────────────────────────────────────────────────────────────

export async function debugScanInfo(): Promise<string> {
  return tauriCmd<string>('debug_scan_info', 'Tauri not available - using fallback');
}

export async function openEnvFolder(): Promise<void> {
  return tauriRun('open_env_folder');
}

// ─── Steam ───────────────────────────────────────────────────────────────────

export interface SteamAchievement {
  apiname:        string;
  achieved:       number;
  unlocktime:     number;
  name?:          string;
  description?:   string;
  icon?:          string;
  icon_unlocked?: string;
  icon_locked?:   string;
}

export async function steamAchievementsDownload(appId: string): Promise<void> {
  return tauriRun('steam_achievements_download', { appId, lang: steamLang() });
}

export async function steamAchievementIcon(appId: string, filename: string): Promise<string | null> {
  return tauriTry<string | null>('steam_achievement_icon', null, { appId, filename });
}

export async function steamGetPlayerAchievements(
  appId: number,
): Promise<{ unlocked: number; total: number; list: SteamAchievement[] } | null> {
  return tauriTry<{ unlocked: number; total: number; list: SteamAchievement[] } | null>(
    'steam_get_player_achievements', null, { appId, lang: steamLang() },
  );
}

export async function steamGetOwnedGames(): Promise<{ game_count?: number; games?: SteamOwnedGame[] } | null> {
  return tauriTry<{ game_count?: number; games?: SteamOwnedGame[] } | null>('steam_get_owned_games', null);
}

export async function saveUserInfo(info: Record<string, unknown>): Promise<void> {
  return tauriRun('save_user_info', { info });
}

export async function getUserInfo(): Promise<Record<string, unknown>> {
  return tauriTry<Record<string, unknown>>('get_user_info', {});
}
