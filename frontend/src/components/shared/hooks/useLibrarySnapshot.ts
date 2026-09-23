import { useEffect, useState } from 'react';
import { getCachedLibraryAndCatalog } from '../../../lib/profile/library-data-cache';
import type { LibraryEntry } from '../../../lib/tauri/library';
import type { CatalogSummary } from '../../../lib/tauri/catalog';

export interface LibrarySnapshot {
  libraryById: ReadonlyMap<string, LibraryEntry>;
  catalogById: ReadonlyMap<string, CatalogSummary>;
}

// The user's library and catalog rows keyed by external id, from the same
// session-wide cache the profile views and SagaCompletionBar read (one IPC
// round trip per session). Null until loaded — and it stays null when the
// read fails, which the creator pages render as "no progress to show".
export function useLibrarySnapshot(): LibrarySnapshot | null {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCachedLibraryAndCatalog()
      .then(({ items, catalog }) => {
        if (cancelled) return;
        setSnapshot({
          libraryById: new Map(items.map(row => [row.external_id, row])),
          catalogById: new Map(catalog.map(row => [row.external_id, row])),
        });
      })
      .catch(() => { /* read-only: no snapshot is what the UI shows for "unknown" */ });
    return () => { cancelled = true; };
  }, []);

  return snapshot;
}
