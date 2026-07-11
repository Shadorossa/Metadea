import { useState, useEffect, useCallback, useRef } from 'react';
import { getAllLibraryEntries, getAllCatalogEntries, type LibraryEntry, type MediaCatalogEntry } from '../../../lib/tauri';
import { isInProgressStatus } from '../../../lib/constants/media';
import type { CategoryId } from '../utils/constants';

// Maps a local-tab category to the media_catalog/library `type` column —
// only categories with a matching library type get the "your works" grid;
// videojuegos (its own scanner) and visual-novel (no catalog type of its
// own users track episodes for) fall back to the raw folder browser.
export const LOCAL_MEDIA_TYPE_BY_CATEGORY: Partial<Record<CategoryId, string>> = {
  anime:        'anime',
  manga:        'manga',
  'light-novel': 'lnovel',
  books:        'book',
  series:       'series',
  movies:       'movie',
};

export interface LocalMediaItem {
  externalId:   string;
  title:        string;
  titleRomaji:  string | null;
  titleNative:  string | null;
  cover:        string | null;
  status:       string;
  progress:     number;
  libraryEntry: LibraryEntry;
  catalogEntry: MediaCatalogEntry | undefined;
}

export function useLocalMediaEntries(category: CategoryId) {
  const [items,   setItems]   = useState<LocalMediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const load = useCallback((category: CategoryId, silent = false) => {
    const type = LOCAL_MEDIA_TYPE_BY_CATEGORY[category];
    if (!type) { setItems([]); setLoading(false); return; }

    if (!silent) setLoading(true);

    return Promise.all([
      getAllLibraryEntries().catch(() => []),
      getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
    ]).then(([entries, catalog]) => {
      if (cancelledRef.current) return;
      const catalogMap = new Map(catalog.map(c => [c.external_id, c]));

      const filtered = entries
        .filter(e => e.type === type && (isInProgressStatus(e.status) || e.status === 'planning'))
        .map((e): LocalMediaItem => {
          const meta = catalogMap.get(e.external_id);
          return {
            externalId:   e.external_id,
            title:        meta?.title_main ?? e.external_id,
            titleRomaji:  meta?.title_romaji ?? null,
            titleNative:  meta?.title_native ?? null,
            cover:        meta?.cover_url ?? null,
            status:       e.status ?? '',
            progress:     e.progress ?? 0,
            libraryEntry: e,
            catalogEntry: meta,
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title));

      setItems(filtered);
    }).finally(() => { if (!cancelledRef.current && !silent) setLoading(false); });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    load(category);
    return () => { cancelledRef.current = true; };
  }, [category, load]);

  // Re-reads from disk without flashing the loading placeholder — used after
  // auto-marking an episode watched so the card grid's progress badge stays
  // current without disrupting whatever's open in the detail panel.
  const refetch = useCallback(() => load(category, true), [category, load]);

  return { items, loading, refetch };
}
