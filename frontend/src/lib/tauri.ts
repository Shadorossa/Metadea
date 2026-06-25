const isTauri = () => typeof window !== 'undefined' && '__TAURI__' in window;

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
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
  const { appDataDir } = await import('@tauri-apps/api/path');
  const dataDir = await appDataDir();
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
  name:        string;
  launcher:    'steam' | 'epic' | 'xbox' | 'gog';
  app_id?:     string;
  install_path?: string;
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

export async function scanAllGames(): Promise<LocalGame[]> {
  return invoke<LocalGame[]>('scan_all_games');
}

export async function pickFolder(): Promise<string | null> {
  return invoke<string | null>('pick_folder');
}

export async function scanFolderContents(path: string): Promise<LocalFolderEntry[]> {
  return invoke<LocalFolderEntry[]>('scan_folder_contents', { path });
}

export async function getLocalFolders(): Promise<SavedFolder[]> {
  return invoke<SavedFolder[]>('get_local_folders');
}

export async function saveLocalFolders(folders: SavedFolder[]): Promise<void> {
  return invoke<void>('save_local_folders', { folders_json: JSON.stringify(folders) });
}

// ─── Env config ───────────────────────────────────────────────────────────────

export interface EnvConfig {
  igdb_client_id?:     string;
  igdb_client_secret?: string;
}

export async function readEnvConfig(): Promise<EnvConfig> {
  return invoke<EnvConfig>('read_env_config');
}

export async function writeEnvConfig(config: EnvConfig): Promise<void> {
  return invoke<void>('write_env_config', { config });
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

export async function igdbSearch(name: string): Promise<IgdbGame[]> {
  return invoke<IgdbGame[]>('igdb_search', { name });
}
