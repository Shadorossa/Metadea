import { getAllLibraryEntries, getAllCatalogEntries } from '../tauri';
import type { LibraryEntry, MediaCatalogEntry } from '../tauri';

// Module-level caches to avoid redundant IPC round trips across profile tabs.
// Invalidated only when real mutations happen (library editor, character edits).
let libraryCache: Promise<{ items: LibraryEntry[]; catalog: MediaCatalogEntry[] }> | null = null;

export function getCachedLibraryAndCatalog(): Promise<{ items: LibraryEntry[]; catalog: MediaCatalogEntry[] }> {
  if (!libraryCache) {
    libraryCache = Promise.all([
      getAllLibraryEntries().catch(() => [] as LibraryEntry[]),
      getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
    ]).then(([items, catalog]) => ({ items, catalog }));
  }
  return libraryCache;
}

function invalidateProfileDataCaches() {
  libraryCache = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('refresh-profile-library', invalidateProfileDataCaches);
}
