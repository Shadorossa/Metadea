import { tauriCmd } from './bridge';
import { applyCoverPreferences, type CatalogSummary, type DbMediaRelation, type MediaCatalogEntry } from './catalog';
import type { LibraryEntry } from './library';
import { isSeriesSeasonSyntheticId } from '../media/mappers/mapper-utils';

// ── Local mount bundle ──────────────────────────────────────────────────────
// The library rows, every visible catalog row as a CatalogSummary, the full
// rows for the library's own game/visual-novel entries and the relations
// over the library's ids, in one round trip (see local_bundle.rs) — what
// useLocalMediaEntries used to assemble from getAllLibraryEntries →
// getAllCatalogEntries (every column of every row) → getMediaRelationsForIds.

export interface LocalLibraryBundle {
  entries: LibraryEntry[];
  catalog: CatalogSummary[];
  game_rows: MediaCatalogEntry[];
  relations: DbMediaRelation[];
}

/** Null outside Tauri; rejects on an IPC/DB failure. */
export async function getLocalLibraryBundle(): Promise<LocalLibraryBundle | null> {
  const bundle = await tauriCmd<LocalLibraryBundle | null>('get_local_library_bundle', null);
  if (!bundle) return null;
  return {
    ...bundle,
    // Same post-processing the standalone wrappers apply: getAllLibraryEntries
    // hides the per-season synthetic rows, the catalog readers fold in the
    // cover preferences.
    entries: bundle.entries.filter(entry => !isSeriesSeasonSyntheticId(entry.external_id)),
    catalog: applyCoverPreferences(bundle.catalog),
    game_rows: applyCoverPreferences(bundle.game_rows),
  };
}

/** Full media_catalog rows (every column) for an explicit id list — the
 *  by-id counterpart of getCatalogEntriesByIds for the one reader per open
 *  panel that needs banners_csv/shop_links_csv/synopsis. Unknown or blocked
 *  ids are simply absent. */
export async function getCatalogEntriesFullByIds(externalIds: string[]): Promise<MediaCatalogEntry[]> {
  if (externalIds.length === 0) return [];
  const rows = await tauriCmd<MediaCatalogEntry[]>('get_catalog_entries_full_by_ids', [], { externalIds });
  return applyCoverPreferences(rows);
}
