import { invoke, markDbReady, waitForTauriBridge } from './bridge';

export async function initTauriDatabase(): Promise<string> {
  if (!(await waitForTauriBridge())) {
    markDbReady();
    reloadIfBridgeArrivesLate();
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

// Safety net for a bridge slower than even the long wait: every read on this
// page already fell back to empty, so once the bridge does attach, reload
// the page once (guarded per session) instead of leaving it blank until F5.
const LATE_BRIDGE_RELOAD_KEY = 'metadea_late_bridge_reload';
const LATE_BRIDGE_WATCH_MS = 60_000;

function reloadIfBridgeArrivesLate(): void {
  if (typeof window === 'undefined') return;
  try {
    if (sessionStorage.getItem(LATE_BRIDGE_RELOAD_KEY)) return;
  } catch { return; }
  void waitForTauriBridge(LATE_BRIDGE_WATCH_MS, 200).then(ready => {
    if (!ready) return;
    try { sessionStorage.setItem(LATE_BRIDGE_RELOAD_KEY, '1'); } catch { /* storage blocked */ }
    window.location.reload();
  });
}
