import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  getAllLibraryEntries, getAllCatalogEntries, getMediaRelationsForIds, getLocalLibraryBundle,
  type LibraryEntry, type CatalogEntryLike, type DbMediaRelation,
} from '../../../lib/tauri';
import { isInProgressStatus } from '../../../lib/media/media-types';
import { LOCAL_CATEGORY_BY_MEDIA_TYPE, type CategoryId } from '../../../lib/local/platforms';

// Maps a local-tab category to the media_catalog/library `type` column —
// only categories listed here get their WHOLE tab replaced by the status-
// grouped "your works" grid. videojuegos keeps its own platform-grouped
// (Steam/Epic/GOG/...) scanner UI instead — LocalLibrary still pulls its
// own 'game'-typed pending items in via useLocalMediaItemsByType directly,
// and tags each installed game with its matched library status, without
// switching its whole layout away from per-platform sections.
// The game category has its own scanner grid; all other Local tabs map
// directly from their catalog type using the shared reverse map.
export const LOCAL_MEDIA_TYPE_BY_CATEGORY: Partial<Record<CategoryId, string>> = Object.fromEntries(
  Object.entries(LOCAL_CATEGORY_BY_MEDIA_TYPE)
    .filter(([mediaType]) => mediaType !== 'game')
    .map(([mediaType, category]) => [category, mediaType]),
) as Partial<Record<CategoryId, string>>;

export type { LocalMediaItem } from '../../../lib/local/local-media-item';
import type { LocalMediaItem } from '../../../lib/local/local-media-item';

export interface LocalMediaRaw {
  entries:   LibraryEntry[];
  // Every visible catalog row in the CatalogSummary projection — the grid,
  // the status matching and the visual-novel classification only read
  // those columns — except the library's own game/visual-novel entries,
  // which are full rows (shop_links_csv, see usePendingLaunchers). A detail
  // panel that needs a wide column for anything else reads that one row by
  // id (lib/local/local-read-cache.ts's readLocalFullCatalogEntries).
  catalog:   CatalogEntryLike[];
  relations: DbMediaRelation[];
}

// Fetches the whole library/catalog set once, plus the relations owned by
// (or pointing at) the library's own rows — the only ones the PREQUEL
// lookup below ever reads — in ONE get_local_library_bundle round trip
// (local_bundle.rs). Every media category's grid is just a different
// filter over the exact same three tables. Called once from LocalLibrary
// itself (which stays mounted for as long as the Local page is open) rather
// than from LocalMediaSection (which unmounts whenever the user steps out
// to "Videojuegos" and back), so switching between categories — including
// via videojuegos — never re-hits the DB or flashes a loading state after
// the very first load.
export function useLocalMediaData() {
  const [raw,     setRaw]     = useState<LocalMediaRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);

    return loadLocalMediaRaw().then(next => {
      if (cancelledRef.current) return;
      setRaw(next);
    }).finally(() => { if (!cancelledRef.current && !silent) setLoading(false); });
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    load();
    return () => { cancelledRef.current = true; };
  }, [load]);

  // Re-reads from disk without flashing the loading placeholder — used after
  // auto-marking an episode watched so the card grid's progress badge stays
  // current without disrupting whatever's open in the detail panel.
  const refetch = useCallback(() => load(true), [load]);

  return { raw, loading, refetch };
}

// The bundle, or — should the bundle command itself fail — the same three
// reads it replaces, each falling back to [] like before.
async function loadLocalMediaRaw(): Promise<LocalMediaRaw> {
  const bundle = await getLocalLibraryBundle().catch((err: unknown) => {
    console.error('[useLocalMediaData] bundle failed, falling back to per-command reads:', err);
    return undefined;
  });
  if (bundle) {
    // Full rows win over their own summary for the same id.
    const fullById = new Map(bundle.game_rows.map(row => [row.external_id, row]));
    const catalog: CatalogEntryLike[] = bundle.catalog.map(row => fullById.get(row.external_id) ?? row);
    return { entries: bundle.entries, catalog, relations: bundle.relations };
  }
  if (bundle === null) return { entries: [], catalog: [], relations: [] };
  const entriesPromise = getAllLibraryEntries().catch(() => [] as LibraryEntry[]);
  const [entries, catalog, relations] = await Promise.all([
    entriesPromise,
    getAllCatalogEntries().catch(() => [] as CatalogEntryLike[]),
    entriesPromise.then(entries => getMediaRelationsForIds(entries.map(e => e.external_id))).catch(() => [] as DbMediaRelation[]),
  ]);
  return { entries, catalog, relations };
}

// Pure derivation over already-fetched data — a category switch is just a
// different filter of the same in-memory tables, so this never touches the
// DB and never has a loading state of its own.
export function useLocalMediaItems(category: CategoryId, raw: LocalMediaRaw | null): LocalMediaItem[] {
  const type = LOCAL_MEDIA_TYPE_BY_CATEGORY[category];
  return useLocalMediaItemsByType(type, raw);
}

// The category-agnostic half of the above — takes a raw media_catalog
// `type` value directly instead of going through the category map, so a
// category whose OWN tab doesn't use the library-backed grid (Videojuegos,
// which has its own Steam/Epic/... scanner UI) can still pull its "obras
// pendientes" (with the same sequel-hiding) as a mixed-in section, the way
// LocalLibrary does for 'game'.
export function useLocalMediaItemsByType(type: string | undefined, raw: LocalMediaRaw | null): LocalMediaItem[] {
  return useMemo((): LocalMediaItem[] => {
    if (!type || !raw) return [];

    const { entries, catalog, relations } = raw;
    const catalogMap = new Map(catalog.map(c => [c.external_id, c]));
    const statusById = new Map(entries.map(e => [e.external_id, e.status ?? '']));

    // Grouped once per render instead of one relations lookup per
    // candidate — cheap since it's all already-fetched, in-memory data.
    const relationsById = new Map<string, DbMediaRelation[]>();
    for (const r of relations) {
      if (!r.media_external_id) continue;
      const list = relationsById.get(r.media_external_id);
      if (list) list.push(r); else relationsById.set(r.media_external_id, [r]);
    }

    const candidates = entries.filter(e => e.type === type && (isInProgressStatus(e.status) || e.status === 'planning'));

    // Hides a direct sequel until its own prequel (still tracked in this
    // library) is completed — a sequel sitting in "Pendientes"/"Sin
    // estrenar" right next to its unfinished prequel is just spoiler-
    // adjacent clutter. Only suppresses when the prequel IS in the
    // library and ISN'T completed — a prequel never added at all gives
    // no way to know whether it's actually been watched, so the sequel
    // stays visible rather than being hidden for an indeterminate reason.
    const visible = candidates.filter(e => {
      const prequel = relationsById.get(e.external_id)?.find(r => r.relation_type === 'PREQUEL');
      if (!prequel) return true;
      const prequelStatus = statusById.get(prequel.related_media_external_id);
      return prequelStatus === undefined || prequelStatus === 'completed';
    });

    return visible
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
  }, [type, raw]);
}
