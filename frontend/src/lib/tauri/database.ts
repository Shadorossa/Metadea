import { isTauri, invoke, markDbReady } from './core';

// isTauri() checks for window.__TAURI_IPC__/__TAURI__ — both injected by
// Tauri's own init scripts, normally present before any page JS runs. But
// right after the app's auto-updater relaunches the process (a slower-than-
// usual cold start — fresh WebView2 profile, antivirus scanning the just-
// written binary, etc.), this page's own astro:page-load handler can fire
// before that injection lands. initTauriDatabase() used to trust a single
// synchronous isTauri() check at that instant and, if it came back false,
// permanently mark the DB "ready" via the not-Tauri fallback — which then
// let every other invoke() call in the app fire immediately, fail with
// "Tauri not available" (since the bridge genuinely wasn't there *yet*),
// and get silently swallowed by their own .catch(() => []) fallbacks. Empty
// UI, no error surfaced, no retry — until a full reload (F5) gave the
// bridge enough time to attach for real. Polling briefly here instead of
// deciding off one synchronous check fixes that race without meaningfully
// affecting real browser (non-Tauri) usage, where this just resolves
// "false" a few hundred ms later than before.
async function waitForTauriBridge(timeoutMs = 1500, intervalMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!isTauri()) {
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return true;
}

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
