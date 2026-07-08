import { STORAGE_KEYS } from '../shared/storage-keys';

// Keys that map to files in %appdata%\com.metadea.app\user_metadata\
const TAURI_KEYS: Record<string, string> = {
  [STORAGE_KEYS.profileAvatarCustom]: 'avatar',
  [STORAGE_KEYS.profileBannerCustom]: 'banner',
};

const isTauri = () =>
  typeof window !== 'undefined' &&
  ('__TAURI__' in window || '__TAURI_IPC__' in window);

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const tauri = window.__TAURI__;
  if (tauri?.core?.invoke) {
    return tauri.core.invoke<T>(cmd, args);
  }
  const { invoke } = await import(/* @vite-ignore */ '@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// ── IndexedDB fallback ────────────────────────────────────────────────────────

const DB_NAME    = 'metadea_profile';
const DB_VERSION = 1;
const STORE_NAME = 'images';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror         = () => reject(request.error);
    request.onsuccess       = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

async function idbSave(key: string, dataUrl: string): Promise<boolean> {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const req = store.put({ key, data: dataUrl, timestamp: Date.now() });
      req.onerror   = () => reject(req.error);
      req.onsuccess = () => resolve();
    });
    return true;
  } catch {
    return false;
  }
}

async function idbGet(key: string): Promise<string | null> {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onerror   = () => reject(req.error);
      req.onsuccess = () => resolve((req.result as { data: string } | undefined)?.data ?? null);
    });
  } catch {
    return null;
  }
}

async function idbRemove(key: string): Promise<boolean> {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const req = store.delete(key);
      req.onerror   = () => reject(req.error);
      req.onsuccess = () => resolve();
    });
    return true;
  } catch {
    return false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function saveImage(key: string, dataUrl: string): Promise<boolean> {
  const tauriKey = TAURI_KEYS[key];
  if (tauriKey && isTauri()) {
    try {
      await tauriInvoke('save_user_image', { key: tauriKey, dataUrl });
      return true;
    } catch (e) {
      console.error('Tauri save_user_image failed:', e);
      return false;
    }
  }
  return idbSave(key, dataUrl);
}

export async function getImage(key: string): Promise<string | null> {
  const tauriKey = TAURI_KEYS[key];
  if (tauriKey && isTauri()) {
    try {
      return await tauriInvoke<string | null>('get_user_image', { key: tauriKey });
    } catch {
      return null;
    }
  }
  return idbGet(key);
}

export async function removeImage(key: string): Promise<boolean> {
  const tauriKey = TAURI_KEYS[key];
  if (tauriKey && isTauri()) {
    try {
      await tauriInvoke('remove_user_image', { key: tauriKey });
      return true;
    } catch {
      return false;
    }
  }
  return idbRemove(key);
}
