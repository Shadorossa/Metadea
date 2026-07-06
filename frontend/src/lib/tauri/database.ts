import { isTauri, invoke } from './core';

export async function initTauriDatabase(): Promise<string> {
  if (!isTauri()) return 'not-tauri';
  const tauri   = window.__TAURI__;
  const dataDir = tauri?.path?.appDataDir ? await tauri.path.appDataDir() : 'unknown';
  return invoke<string>('init_database', { app_data_dir: dataDir });
}
