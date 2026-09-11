// IndexedDB-based LRU cache for theme preview videos
// Stores up to 100MB of video clips with automatic cleanup

const DB_NAME = 'metadea-theme-cache';
const STORE_NAME = 'videos';
const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB
const PREVIEW_DURATION = 3; // seconds

interface CacheEntry {
  key: string;
  blob: Blob;
  size: number;
  createdAt: number;
  lastAccessedAt: number;
}

let db: IDBDatabase | null = null;

async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

async function getTotalCacheSize(): Promise<number> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const entries = request.result as CacheEntry[];
      const total = entries.reduce((sum, entry) => sum + entry.size, 0);
      resolve(total);
    };
  });
}

async function cleanupLRU(neededSpace: number): Promise<void> {
  const database = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const entries = (request.result as CacheEntry[]).sort(
        (a, b) => a.lastAccessedAt - b.lastAccessedAt
      );

      let freed = 0;
      const toDelete: string[] = [];

      for (const entry of entries) {
        if (freed >= neededSpace) break;
        toDelete.push(entry.key);
        freed += entry.size;
      }

      // Delete entries
      const deleteTransaction = database.transaction(STORE_NAME, 'readwrite');
      const deleteStore = deleteTransaction.objectStore(STORE_NAME);

      let deleteCount = 0;
      for (const key of toDelete) {
        deleteStore.delete(key);
        deleteCount++;
      }

      deleteTransaction.onerror = () => reject(deleteTransaction.error);
      deleteTransaction.oncomplete = () => {
        console.log(`[ThemeCache] Cleaned up ${deleteCount} entries, freed ~${Math.round(freed / 1024 / 1024)}MB`);
        resolve();
      };
    };
  });
}

export async function getCachedThemeVideo(key: string): Promise<Blob | null> {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entry = request.result as CacheEntry | undefined;
        if (!entry) {
          resolve(null);
          return;
        }

        // Update last accessed time
        entry.lastAccessedAt = Date.now();
        store.put(entry);

        resolve(entry.blob);
      };
    });
  } catch (err) {
    console.warn('[ThemeCache] Failed to get cached video:', err);
    return null;
  }
}

export async function cacheThemeVideo(key: string, blob: Blob): Promise<void> {
  try {
    const currentSize = await getTotalCacheSize();
    const newSize = blob.size;
    const totalAfter = currentSize + newSize;

    // If adding this would exceed limit, cleanup first
    if (totalAfter > MAX_CACHE_SIZE) {
      const neededSpace = totalAfter - MAX_CACHE_SIZE;
      await cleanupLRU(neededSpace);
    }

    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const entry: CacheEntry = {
        key,
        blob,
        size: blob.size,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
      };

      const request = store.put(entry);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log(`[ThemeCache] Cached ${key} (${Math.round(blob.size / 1024)}KB)`);
        resolve();
      };
    });
  } catch (err) {
    console.warn('[ThemeCache] Failed to cache video:', err);
  }
}

export async function clearThemeCache(): Promise<void> {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        console.log('[ThemeCache] Cache cleared');
        resolve();
      };
    });
  } catch (err) {
    console.warn('[ThemeCache] Failed to clear cache:', err);
  }
}

export async function getThemeCacheStats(): Promise<{
  totalSize: number;
  totalEntries: number;
  percentUsed: number;
}> {
  try {
    const database = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const entries = request.result as CacheEntry[];
        const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
        resolve({
          totalSize,
          totalEntries: entries.length,
          percentUsed: (totalSize / MAX_CACHE_SIZE) * 100,
        });
      };
    });
  } catch (err) {
    console.warn('[ThemeCache] Failed to get stats:', err);
    return { totalSize: 0, totalEntries: 0, percentUsed: 0 };
  }
}
