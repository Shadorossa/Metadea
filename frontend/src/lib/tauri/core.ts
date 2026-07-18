// Low-level Tauri IPC helpers shared by every domain module in this folder.
// Every domain file (auth, library, catalog, ...) builds on these instead of
// calling `invoke`/`localStorage` directly, so the browser-vs-Tauri fallback
// logic lives in exactly one place.

export const isTauri = (): boolean => {
  if (typeof window === 'undefined') return false;
  if ('__TAURI_IPC__' in window) return true;
  if ('__TAURI__' in window) return true;
  return false;
};

// isTauri() checks for window.__TAURI_IPC__/__TAURI__, both injected by
// Tauri's own init scripts — normally present before any page JS runs, but
// right after the app's auto-updater relaunches the process (a slower-than-
// usual cold start: fresh WebView2 profile, antivirus scanning the just-
// written binary, etc.) that injection can land after this page's scripts
// start firing. Any invoke() call that races ahead of it used to fail
// immediately with "Tauri not available" and get silently swallowed by
// callers' own .catch(() => []) fallbacks — empty UI, no error, no retry,
// until a full reload (F5) gave the bridge enough time to attach for real.
// Polling briefly instead of deciding off one synchronous check fixes that
// without meaningfully affecting real browser (non-Tauri) usage, where this
// just resolves "false" a few hundred ms later than before.
export async function waitForTauriBridge(timeoutMs = 1500, intervalMs = 50): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!isTauri()) {
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return true;
}

let dbReadyPromise: Promise<void> | null = null;
let resolveDbReady: (() => void) | null = null;

function getDbReadyPromise(): Promise<void> {
  if (!dbReadyPromise) {
    dbReadyPromise = new Promise((resolve) => {
      resolveDbReady = resolve;
    });
  }
  return dbReadyPromise;
}

export function markDbReady() {
  getDbReadyPromise();
  if (resolveDbReady) resolveDbReady();
}

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri() && !(await waitForTauriBridge())) {
    console.warn(`[Tauri] "${cmd}" called outside Tauri`);
    throw new Error('Tauri not available');
  }

  if (cmd !== 'init_database') {
    await getDbReadyPromise();
  }

  const tauri = window.__TAURI__;
  if (tauri?.core?.invoke) return tauri.core.invoke<T>(cmd, args);
  const { invoke: tauriInvoke } = await import(/* @vite-ignore */ '@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

// These helpers used to gate on a single synchronous isTauri() check, same
// as invoke() itself did before the waitForTauriBridge() fix above — same
// race, same silent-empty-fallback symptom, since a fallback returned here
// never even reaches invoke()'s own (now-fixed) wait. Awaiting the bridge
// here too means a caller genuinely running in a browser (no Tauri ever)
// just waits out the same ~1.5s once before getting its fallback, same as
// before this fix existed.
async function isTauriReady(): Promise<boolean> {
  return isTauri() || waitForTauriBridge();
}

// No-op when not in Tauri
export async function tauriRun(cmd: string, args?: Record<string, unknown>): Promise<void> {
  if (!(await isTauriReady())) return;
  return invoke<void>(cmd, args);
}

// Returns fallback when not in Tauri
export async function tauriCmd<T>(cmd: string, fallback: T, args?: Record<string, unknown>): Promise<T> {
  if (!(await isTauriReady())) return fallback;
  return invoke<T>(cmd, args);
}

// Returns fallback when not in Tauri or on error
export async function tauriTry<T>(cmd: string, fallback: T, args?: Record<string, unknown>): Promise<T> {
  if (!(await isTauriReady())) return fallback;
  try { return await invoke<T>(cmd, args); } catch { return fallback; }
}

// Read a JSON-string file from Tauri, or localStorage in browser
export async function readStoredJson<T>(cmd: string, localKey: string, fallback: T): Promise<T> {
  if (!(await isTauriReady())) {
    try {
      const s = localStorage.getItem(localKey);
      return s ? JSON.parse(s) : fallback;
    } catch { return fallback; }
  }
  try { return JSON.parse(await invoke<string>(cmd)); } catch { return fallback; }
}

// Write a value as a JSON-string file to Tauri, or localStorage in browser
export async function writeStoredJson<T>(cmd: string, localKey: string, value: T, argKey = 'content'): Promise<void> {
  const content = JSON.stringify(value, null, 2);
  if (!(await isTauriReady())) { localStorage.setItem(localKey, content); return; }
  return invoke<void>(cmd, { [argKey]: content });
}

export function wrapAssetUrl(filePath: string): string {
  if (!isTauri() || !filePath) return filePath;
  // If it's a protocol-relative URL (like //images.igdb.com/...), normalize it to https:
  if (filePath.startsWith('//')) {
    filePath = 'https:' + filePath;
  }
  // If it's already a URL scheme (http/https/data), don't touch it
  if (filePath.startsWith('http') || filePath.startsWith('data:') || filePath.startsWith('asset:')) return filePath;
  
  try {
    const tauri = window.__TAURI__;
    if (tauri?.core?.convertFileSrc) {
      return tauri.core.convertFileSrc(filePath);
    }
    // Fallback: manually prefix for asset protocol if internals aren't fully resolved yet.
    // Windows/Android serve it over https, not the "asset:" scheme used elsewhere.
    const segments = filePath.replace(/\\/g, '/').split('/').map(encodeURIComponent);
    return `https://asset.localhost/${segments.join('/')}`;
  } catch (e) {
    console.error('Failed to convert file src:', e);
    return filePath;
  }
}
