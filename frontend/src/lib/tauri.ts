import { invoke } from '@tauri-apps/api/tauri';
import { appDataDir } from '@tauri-apps/api/path';

interface LibraryItem {
  id?: number;
  external_id: string;
  item_type: string;
  rating?: number;
  status?: string;
}

export async function initTauriDatabase(): Promise<string> {
  const dataDir = await appDataDir();
  return invoke('init_database', { app_data_dir: dataDir });
}

export async function saveLibraryItem(
  external_id: string,
  item_type: string,
  options?: {
    rating?: number;
    status?: string;
  }
): Promise<string> {
  return invoke('save_library_item', {
    external_id,
    item_type,
    rating: options?.rating,
    status: options?.status,
  });
}

export async function getLibraryItems(): Promise<LibraryItem[]> {
  return invoke('get_library_items');
}

export async function getLibraryStats(): Promise<{
  total: number;
  by_type: Record<string, number>;
}> {
  return invoke('get_library_stats');
}

export async function isTauriApp(): Promise<boolean> {
  try {
    await invoke('ping');
    return true;
  } catch {
    return false;
  }
}
