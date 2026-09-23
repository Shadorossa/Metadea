import { useEffect, useState } from 'react';
import { getCachedLibraryAndCatalog } from '../../../lib/profile/library-data-cache';
import { readUserFavoritesTyped } from '../../../lib/tauri/favorites';
import type { CatalogSummary, LibraryEntry } from '../../../lib/tauri';

// The user's library + catalog summaries + favourite ids, from the profile's
// shared cache (one IPC round trip across the whole app). Read-only; a
// failure leaves the panels empty with their own "nothing here" state.

export interface TierLibraryData {
  loaded: boolean;
  entries: LibraryEntry[];
  catalog: Map<string, CatalogSummary>;
  favoriteIds: Set<string>;
}

const EMPTY: TierLibraryData = { loaded: false, entries: [], catalog: new Map(), favoriteIds: new Set() };

export function useTierLibraryData(enabled = true): TierLibraryData {
  const [data, setData] = useState<TierLibraryData>(EMPTY);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    Promise.all([
      getCachedLibraryAndCatalog().catch(() => ({ items: [] as LibraryEntry[], catalog: [] as CatalogSummary[] })),
      readUserFavoritesTyped().catch(() => ({} as Record<string, string[]>)),
    ]).then(([library, favorites]) => {
      if (cancelled) return;
      const favoriteIds = new Set(Object.entries(favorites).filter(([type]) => type !== 'character').flatMap(([, ids]) => ids));
      setData({ loaded: true, entries: library.items, catalog: new Map(library.catalog.map(c => [c.external_id, c])), favoriteIds });
    });
    return () => { cancelled = true; };
  }, [enabled]);
  return data;
}
