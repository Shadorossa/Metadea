import { STORAGE_KEYS } from '../shared/storage-keys';
import { isTauri, invoke as tauriInvoke } from '../tauri/core';

const TAURI_KEYS: Record<string, string> = {
  [STORAGE_KEYS.profileAvatarCustom]: 'avatar',
  [STORAGE_KEYS.profileBannerCustom]: 'banner',
};

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

function syncLocalStorageCache(key: string, dataUrl: string | null): void {
  if (typeof localStorage === 'undefined') return;
  const cacheKey = key === STORAGE_KEYS.profileBannerCustom ? 'profile_banner_cache' : key === STORAGE_KEYS.profileAvatarCustom ? 'profile_avatar_cache' : null;
  if (!cacheKey) return;
  if (dataUrl) {
    try { localStorage.setItem(cacheKey, dataUrl); } catch {}
  } else {
    localStorage.removeItem(cacheKey);
  }
}

export async function saveImage(key: string, dataUrl: string): Promise<boolean> {
  const tauriKey = TAURI_KEYS[key];
  let ok = false;
  if (tauriKey && isTauri()) {
    try {
      await tauriInvoke('save_user_image', { key: tauriKey, dataUrl });
      ok = true;
    } catch (e) {
      console.error('Tauri save_user_image failed:', e);
      ok = false;
    }
  } else {
    ok = await idbSave(key, dataUrl);
  }
  if (ok) syncLocalStorageCache(key, dataUrl);
  return ok;
}

export async function getImage(key: string): Promise<string | null> {
  const tauriKey = TAURI_KEYS[key];
  let res: string | null = null;
  if (tauriKey && isTauri()) {
    try {
      res = await tauriInvoke<string | null>('get_user_image', { key: tauriKey });
    } catch {
      res = null;
    }
  } else {
    res = await idbGet(key);
  }
  if (res) syncLocalStorageCache(key, res);
  return res;
}

export async function removeImage(key: string): Promise<boolean> {
  const tauriKey = TAURI_KEYS[key];
  let ok = false;
  if (tauriKey && isTauri()) {
    try {
      await tauriInvoke('remove_user_image', { key: tauriKey });
      ok = true;
    } catch {
      ok = false;
    }
  } else {
    ok = await idbRemove(key);
  }
  syncLocalStorageCache(key, null);
  return ok;
}
