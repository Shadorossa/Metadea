import { tauriCmd } from './bridge';
import { applyCoverPreferences, type CatalogSummary, type DbMediaRelation } from './catalog';
import type { LibraryEntry } from './library';
import { isSeriesSeasonSyntheticId } from '../media/mappers/mapper-utils';

// ── Home mount bundle ───────────────────────────────────────────────────────
// The library, its catalog summaries, the scoped relations closure and the
// saga names in one round trip (see home_bundle.rs) — the exact rows the
// getAllLibraryEntries → getCatalogEntriesForLibrary →
// loadScopedMediaRelations → getCatalogEntriesByIds → getSagaNames chain
// returns, so lib/profile/library-data-cache.ts can be primed with it.

export interface HomeBundle {
  library: LibraryEntry[];
  catalog: CatalogSummary[];
  relations: DbMediaRelation[];
  saga_names: Record<string, string>;
}

export interface HomeBundleScope {
  /** Relation kinds whose chains the closure follows (CHAIN_RELATION_TYPES). */
  chainTypes: string[];
  /** Relation kinds dropped entirely (EXCLUDED_RELATION_TYPES). */
  excludeTypes: string[];
  /** Expansion rounds after the seed fetch (MAX_EXPANSION_HOPS). */
  maxHops: number;
}

/** Null outside Tauri; rejects on an IPC/DB failure so the caller can fall
 *  back to the per-command chain. */
export async function getHomeBundle(scope: HomeBundleScope): Promise<HomeBundle | null> {
  const bundle = await tauriCmd<HomeBundle | null>('get_home_bundle', null, {
    chainTypes: scope.chainTypes,
    excludeTypes: scope.excludeTypes,
    maxHops: scope.maxHops,
  });
  if (!bundle) return null;
  return {
    ...bundle,
    // Same post-processing the standalone wrappers apply: getAllLibraryEntries
    // hides the per-season synthetic rows, getCatalogEntriesForLibrary /
    // getCatalogEntriesByIds fold in the cover preferences.
    library: bundle.library.filter(entry => !isSeriesSeasonSyntheticId(entry.external_id)),
    catalog: applyCoverPreferences(bundle.catalog),
  };
}
