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

let dbReadyPromise: Promise<void> | null = null;
let resolveDbReady: (() => void) | null = null;

export function getDbReadyPromise(): Promise<void> {
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
  if (!isTauri()) {
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

// No-op when not in Tauri
export async function tauriRun(cmd: string, args?: Record<string, unknown>): Promise<void> {
  if (!isTauri()) return;
  return invoke<void>(cmd, args);
}

// Returns fallback when not in Tauri
export async function tauriCmd<T>(cmd: string, fallback: T, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return fallback;
  return invoke<T>(cmd, args);
}

// Returns fallback when not in Tauri or on error
export async function tauriTry<T>(cmd: string, fallback: T, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) return fallback;
  try { return await invoke<T>(cmd, args); } catch { return fallback; }
}

// Read a JSON-string file from Tauri, or localStorage in browser
export async function readStoredJson<T>(cmd: string, localKey: string, fallback: T): Promise<T> {
  if (!isTauri()) {
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
  if (!isTauri()) { localStorage.setItem(localKey, content); return; }
  return invoke<void>(cmd, { [argKey]: content });
}

export async function pathToDataUrl(filePath: string): Promise<string | null> {
  return tauriTry<string | null>('file_to_data_url', null, { filePath });
}
