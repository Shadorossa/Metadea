import { getAllLibraryEntries, getAllCatalogEntries } from '../tauri';
import type { LibraryEntry, MediaCatalogEntry } from '../tauri';

// Every Profile tab (Library, Stats, Favorites, Lists, Reviews) used to
// independently re-fetch the entire library + catalog on its own mount —
// switching tabs meant re-issuing the same two full-table IPC round trips
// every time, even when nothing had changed since the last visit. This
// module-level cache makes the first fetch of a session shared by every
// consumer; only a real mutation (library editor save/delete, which already
// dispatches 'refresh-profile-library' — see ProfileLibraryEditor.tsx)
// invalidates it.
let cache: Promise<{ items: LibraryEntry[]; catalog: MediaCatalogEntry[] }> | null = null;

export function getCachedLibraryAndCatalog(): Promise<{ items: LibraryEntry[]; catalog: MediaCatalogEntry[] }> {
  if (!cache) {
    cache = Promise.all([
      getAllLibraryEntries().catch(() => [] as LibraryEntry[]),
      getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
    ]).then(([items, catalog]) => ({ items, catalog }));
  }
  return cache;
}

export function invalidateLibraryDataCache() {
  cache = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('refresh-profile-library', invalidateLibraryDataCache);
}
