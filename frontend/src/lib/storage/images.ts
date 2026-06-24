const DB_NAME    = 'metadea_profile';
const DB_VERSION = 1;
const STORE_NAME = 'images';

interface ImageData {
  key: string;
  data: string;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror        = () => reject(request.error);
    request.onsuccess      = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });
}

export async function saveImage(key: string, dataUrl: string): Promise<boolean> {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store.put({ key, data: dataUrl, timestamp: Date.now() });
      request.onerror   = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
    return true;
  } catch (e) {
    console.error('IndexedDB save failed:', e);
    return false;
  }
}

export async function getImage(key: string): Promise<string | null> {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onerror   = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result as ImageData | undefined;
        resolve(result?.data ?? null);
      };
    });
  } catch (e) {
    console.error('IndexedDB read failed:', e);
    return null;
  }
}

export async function removeImage(key: string): Promise<boolean> {
  try {
    const db    = await openDB();
    const tx    = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store.delete(key);
      request.onerror   = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
    return true;
  } catch (e) {
    console.error('IndexedDB delete failed:', e);
    return false;
  }
}
