import { invoke, markDbReady, waitForTauriBridge } from './core';

export async function initTauriDatabase(): Promise<string> {
  if (!(await waitForTauriBridge())) {
    markDbReady();
    return 'not-tauri';
  }
  // markDbReady() must fire even if this throws (a transient IPC hiccup right
  // after the bridge attaches, appDataDir() rejecting, etc.) — every other
  // invoke() call on this page (and any soft-navigated page, since
  // dbReadyPromise is a module-level singleton that outlives Astro view
  // transitions) awaits this same promise and would otherwise hang forever
  // instead of erroring, since nothing else ever resolves it. That reads as
  // "blank page" / "results never load" until a full reload resets the module.
  try {
    const tauri   = window.__TAURI__;
    const dataDir = tauri?.path?.appDataDir ? await tauri.path.appDataDir() : 'unknown';
    return await invoke<string>('init_database', { app_data_dir: dataDir });
  } finally {
    markDbReady();
  }
}
