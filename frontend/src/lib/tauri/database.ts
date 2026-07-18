import { invoke, markDbReady, waitForTauriBridge } from './core';

export async function initTauriDatabase(): Promise<string> {
  if (!(await waitForTauriBridge())) {
    markDbReady();
    return 'not-tauri';
  }
  const tauri   = window.__TAURI__;
  const dataDir = tauri?.path?.appDataDir ? await tauri.path.appDataDir() : 'unknown';
  const res = await invoke<string>('init_database', { app_data_dir: dataDir });
  markDbReady();
  return res;
}
