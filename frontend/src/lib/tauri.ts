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
  id?:        number;
  external_id: string;
  item_type:   string;
  rating?:     number;
  status?:     string;
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
