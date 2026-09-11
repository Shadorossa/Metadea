import { getAllLibraryEntries, getAllCatalogEntries, getAllCharacters, getCustomImagesMap } from '../tauri';
import type { LibraryEntry, MediaCatalogEntry, FavoriteCustomImage } from '../tauri';
import type { CharacterEntry } from '../tauri/characters';

// Module-level caches to avoid redundant IPC round trips across profile tabs.
// Invalidated only when real mutations happen (library editor, character edits).
let libraryCache: Promise<{ items: LibraryEntry[]; catalog: MediaCatalogEntry[] }> | null = null;
let charactersCache: Promise<CharacterEntry[]> | null = null;
let customImagesCache: Promise<Map<string, FavoriteCustomImage>> | null = null;

export function getCachedLibraryAndCatalog(): Promise<{ items: LibraryEntry[]; catalog: MediaCatalogEntry[] }> {
  if (!libraryCache) {
    libraryCache = Promise.all([
      getAllLibraryEntries().catch(() => [] as LibraryEntry[]),
      getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
    ]).then(([items, catalog]) => ({ items, catalog }));
  }
  return libraryCache;
}

export function getCachedCharacters(): Promise<CharacterEntry[]> {
  if (!charactersCache) {
    charactersCache = getAllCharacters().catch(() => [] as CharacterEntry[]);
  }
  return charactersCache;
}

export function getCachedCustomImages(): Promise<Map<string, FavoriteCustomImage>> {
  if (!customImagesCache) {
    customImagesCache = getCustomImagesMap().catch(() => new Map<string, FavoriteCustomImage>());
  }
  return customImagesCache;
}

function invalidateProfileDataCaches() {
  libraryCache = null;
  charactersCache = null;
  customImagesCache = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('refresh-profile-library', invalidateProfileDataCaches);
}
