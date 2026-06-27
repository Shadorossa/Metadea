const isTauri = (): boolean => {
  if (typeof window === 'undefined') return false;
  // __TAURI_IPC__ is always injected by the Tauri webview (most reliable)
  if ('__TAURI_IPC__' in window) return true;
  // __TAURI__ is available when withGlobalTauri: true
  if ('__TAURI__' in window) return true;
  return false;
};

/** Convert a file path to a data URL (base64 encoded). */
export async function pathToDataUrl(filePath: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    // Use invoke to call a custom Tauri command that reads and encodes the file
    const dataUrl = await invoke<string>('file_to_data_url', { filePath });
    return dataUrl;
  } catch (err) {
    console.warn('[Tauri] Failed to read file:', filePath, err);
    return null;
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    console.warn(`[Tauri] "${cmd}" called outside Tauri`);
    throw new Error('Tauri not available');
  }
  const tauri = (window as any).__TAURI__;
  if (tauri?.core?.invoke) {
    return tauri.core.invoke(cmd, args);
  }
  const { invoke: tauriInvoke } = await import(/* @vite-ignore */ '@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

// ─── Auth ────────────────────────────────────────────────────────────────────

export interface AuthSession {
  token:    string;
  username: string;
}

export async function storeAuthToken(token: string, username: string): Promise<void> {
  // Siempre escribir en localStorage para acceso rápido sin depender del DB
  localStorage.setItem('auth_token',    token);
  localStorage.setItem('auth_username', username);
  // Persistir también en SQLite de Tauri si está disponible
  if (isTauri()) {
    await invoke('store_auth_token', { token, username });
  }
}

export async function getAuthToken(): Promise<AuthSession | null> {
  // Ruta rápida: localStorage (funciona en browser y en Tauri sin init de DB)
  const token    = localStorage.getItem('auth_token');
  const username = localStorage.getItem('auth_username') ?? '';
  if (token) return { token, username };

  // Ruta lenta: SQLite de Tauri (fallback si localStorage fue borrado)
  if (isTauri()) {
    try {
      const session = await invoke<AuthSession | null>('get_auth_token');
      if (session) {
        localStorage.setItem('auth_token',    session.token);
        localStorage.setItem('auth_username', session.username);
      }
      return session;
    } catch {
      return null;
    }
  }
  return null;
}

export async function clearAuthToken(): Promise<void> {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_username');
  if (isTauri()) {
    await invoke('clear_auth_token');
  }
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
  // Use path API from window.__TAURI__ global
  const tauri = (window as any).__TAURI__;
  const dataDir = tauri?.path?.appDataDir
    ? await tauri.path.appDataDir()
    : 'unknown';
  return invoke<string>('init_database', { app_data_dir: dataDir });
}

export async function saveLibraryItem(
  external_id: string,
  item_type:   string,
  options?:    { rating?: number; status?: string },
): Promise<string> {
  return invoke<string>('save_library_item', {
    external_id,
    item_type,
    rating: options?.rating,
    status: options?.status,
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
  name:             string;
  launcher:         'steam' | 'epic' | 'xbox' | 'gog' | 'ea' | 'local';
  app_id?:          string;
  install_path?:    string;
  playtime_minutes?: number;
  last_played?:     number;
  installed?:       boolean;
}

export interface SteamOwnedGame {
  appid:              number;
  name:               string;
  playtime_forever:   number;
  rtime_last_played?: number;
  img_icon_url?:      string;
}

export interface LocalFolderEntry {
  name:        string;
  is_dir:      boolean;
  size:        number;
  child_count?: number;
}

export interface SavedFolder {
  path:  string;
  label: string;
}

export async function pickFolder(): Promise<string | null> {
  if (!isTauri()) {
    // Fallback: no picker disponible en browser
    return null;
  }
  return invoke<string | null>('pick_folder');
}

export async function scanFolderContents(path: string): Promise<LocalFolderEntry[]> {
  if (!isTauri()) {
    // Fallback: no access al filesystem en browser
    return [];
  }
  return invoke<LocalFolderEntry[]>('scan_folder_contents', { path });
}

export async function scanAllGames(): Promise<LocalGame[]> {
  if (!isTauri()) {
    // Fallback: retorna array vacío
    return [];
  }
  return invoke<LocalGame[]>('scan_all_games');
}

export async function getLocalFolders(): Promise<SavedFolder[]> {
  if (!isTauri()) {
    // Fallback a localStorage
    const stored = localStorage.getItem('local_folders');
    return stored ? JSON.parse(stored) : [];
  }
  return invoke<SavedFolder[]>('get_local_folders');
}

export async function saveLocalFolders(folders: SavedFolder[]): Promise<void> {
  if (!isTauri()) {
    // Fallback a localStorage
    localStorage.setItem('local_folders', JSON.stringify(folders));
    return;
  }
  return invoke<void>('save_local_folders', { folders_json: JSON.stringify(folders) });
}

// ─── Category routes ──────────────────────────────────────────────────────────

export async function readRoutes(): Promise<Record<string, string>> {
  if (!isTauri()) {
    const stored = localStorage.getItem('category_routes');
    return stored ? JSON.parse(stored) : {};
  }
  try {
    const json = await invoke<string>('read_routes');
    return JSON.parse(json);
  } catch {
    return {};
  }
}

export async function writeRoutes(routes: Record<string, string>): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem('category_routes', JSON.stringify(routes));
    return;
  }
  await invoke<void>('write_routes', { routes_json: JSON.stringify(routes) });
}

// ─── Env config ───────────────────────────────────────────────────────────────

export interface EnvConfig {
  igdb_client_id?:     string;
  igdb_client_secret?: string;
  steam_api_key?:      string;
}

export async function readEnvConfig(): Promise<EnvConfig> {
  // In Tauri: always read from disk (env.json) — it's the source of truth
  if (isTauri()) {
    try {
      const cfg = await invoke<EnvConfig>('read_env_config');
      // Keep localStorage in sync for quick access
      localStorage.setItem('env_config', JSON.stringify(cfg));
      return cfg;
    } catch {
      // fall through to localStorage
    }
  }
  // Browser fallback: localStorage
  const stored = localStorage.getItem('env_config');
  if (stored) return JSON.parse(stored);
  return { igdb_client_id: undefined, igdb_client_secret: undefined };
}

export async function writeEnvConfig(config: EnvConfig): Promise<void> {
  // Always sync localStorage
  localStorage.setItem('env_config', JSON.stringify(config));

  // In Tauri: write to disk (env.json) — this is what persists across sessions
  if (isTauri()) {
    try {
      await invoke<void>('write_env_config', { config });
    } catch (err) {
      throw new Error(`write_env_config failed: ${err}`);
    }
  }
}

// ─── IGDB ─────────────────────────────────────────────────────────────────────

export interface IgdbNamed    { id: number; name: string }
export interface IgdbImage    { id: number; image_id: string }
export interface IgdbCover    { id: number; image_id: string }
export interface IgdbInvolvedCompany {
  id: number;
  company?:   IgdbNamed;
  developer?: boolean;
  publisher?: boolean;
}
export interface IgdbGame {
  id:               number;
  name:             string;
  summary?:         string;
  cover?:           IgdbCover;
  screenshots?:     IgdbImage[];
  artworks?:        IgdbImage[];
  genres?:          IgdbNamed[];
  involved_companies?: IgdbInvolvedCompany[];
  first_release_date?: number; // unix timestamp
  rating?:          number;
  rating_count?:    number;
}

export function igdbImageUrl(imageId: string, size = 'screenshot_big'): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

export async function igdbSearch(query: string, isVisualNovel: boolean = false): Promise<IgdbGame[]> {
  return invoke<IgdbGame[]>('igdb_search', { query, isVisualNovel });
}

export async function igdbGetGameDetail(igdbId: number): Promise<Record<string, unknown> | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<Record<string, unknown> | null>('igdb_get_game_detail', { igdbId });
  } catch {
    return null;
  }
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

export async function igdbGetCoverBySteamId(
  appId: string,
  gameName: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>('igdb_get_cover_by_steam_id', { appId, gameName });
}

export interface IgdbCandidate {
  id: number;
  name: string;
  year: number;
  cover_url: string;
  developer: string;
}

export async function igdbSearchCandidates(gameName: string): Promise<IgdbCandidate[]> {
  if (!isTauri()) return [];
  return invoke<IgdbCandidate[]>('igdb_search_candidates', { gameName });
}

export async function igdbForceByIgdbId(
  appId: string,
  gameName: string,
  igdbId: number,
): Promise<string> {
  if (!isTauri()) return '';
  return invoke<string>('igdb_force_by_igdb_id', { appId, gameName, igdbId });
}

export interface MetaEntry {
  cover_path?:  string; // absolute path to cover file
  banner_path?: string; // absolute path to banner file
}

/** Returns { app_id → { cover?, banner? } } for all downloaded assets. */
export async function readMetadataIndex(): Promise<Record<string, MetaEntry>> {
  if (!isTauri()) return {};
  return invoke<Record<string, MetaEntry>>('read_metadata_index');
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
    main_story_minutes?:     number;
    main_extra_minutes?:     number;
    completionist_minutes?:  number;
  };
  last_fetched?: string;
}

/** Reads game metadata from `metadata/{app_id}/info.json`. */
export async function readGameInfo(appId: string): Promise<GameInfo | null> {
  if (!isTauri()) return null;
  try {
    const info = await invoke<GameInfo>('read_game_info', { appId });
    return info && Object.keys(info).length > 0 ? info : null;
  } catch {
    return null;
  }
}

// ─── Debug ────────────────────────────────────────────────────────────────────

export async function debugScanInfo(): Promise<string> {
  if (!isTauri()) {
    return 'Tauri not available - using fallback';
  }
  return invoke<string>('debug_scan_info');
}

export async function openEnvFolder(): Promise<void> {
  if (!isTauri()) {
    console.warn('Cannot open folder outside Tauri');
    return;
  }
  return invoke<void>('open_env_folder');
}

export interface SteamAchievement {
  apiname:         string;
  achieved:        number;
  unlocktime:      number;
  name?:           string;
  description?:    string;
  icon?:           string;      // CDN URL (live fetch)
  icon_unlocked?:  string;      // local filename: {apiname}_unlocked.jpg
  icon_locked?:    string;      // local filename: {apiname}_locked.jpg
}

export async function steamAchievementsDownload(appId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke<void>('steam_achievements_download', { appId, lang: steamLang() });
}

export async function steamAchievementIcon(appId: string, filename: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string>('steam_achievement_icon', { appId, filename });
  } catch {
    return null;
  }
}

export async function steamGetPlayerAchievements(appId: number): Promise<{ unlocked: number; total: number; list: SteamAchievement[] } | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<{ unlocked: number; total: number; list: SteamAchievement[] }>('steam_get_player_achievements', { appId, lang: steamLang() });
  } catch {
    return null;
  }
}

export async function steamGetOwnedGames(): Promise<{ game_count?: number; games?: SteamOwnedGame[] } | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<{ game_count?: number; games?: SteamOwnedGame[] }>('steam_get_owned_games');
  } catch {
    return null;
  }
}

export async function saveUserInfo(info: Record<string, unknown>): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>('save_user_info', { info });
}

export async function getUserInfo(): Promise<Record<string, unknown>> {
  if (!isTauri()) return {};
  try {
    return await invoke<Record<string, unknown>>('get_user_info');
  } catch { return {}; }
}
