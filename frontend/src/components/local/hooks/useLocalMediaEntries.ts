import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getAllLibraryEntries, getAllCatalogEntries, getAllMediaRelations, type LibraryEntry, type MediaCatalogEntry, type DbMediaRelation } from '../../../lib/tauri';
import { isInProgressStatus } from '../../../lib/constants/media';
import type { CategoryId } from '../utils/constants';

// Maps a local-tab category to the media_catalog/library `type` column —
// only categories listed here get their WHOLE tab replaced by the status-
// grouped "your works" grid. videojuegos keeps its own platform-grouped
// (Steam/Epic/GOG/...) scanner UI instead — LocalLibrary still pulls its
// own 'game'-typed pending items in via useLocalMediaItemsByType directly,
// and tags each installed game with its matched library status, without
// switching its whole layout away from per-platform sections.
export const LOCAL_MEDIA_TYPE_BY_CATEGORY: Partial<Record<CategoryId, string>> = {
  anime:        'anime',
  manga:        'manga',
  'light-novel': 'lnovel',
  books:        'book',
  comics:       'comic',
  series:       'series',
  movies:       'movie',
  'visual-novel': 'vnovel',
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

export interface LocalMediaRaw {
  entries:   LibraryEntry[];
  catalog:   MediaCatalogEntry[];
  relations: DbMediaRelation[];
}

// Fetches the whole library/catalog/relations set once — every media
// category's grid is just a different filter over the exact same three
// tables. Called once from LocalLibrary itself (which stays mounted for as
// long as the Local page is open) rather than from LocalMediaSection (which
// unmounts whenever the user steps out to "Videojuegos" and back), so
// switching between categories — including via videojuegos — never re-hits
// the DB or flashes a loading state after the very first load.
export function useLocalMediaData() {
  const [raw,     setRaw]     = useState<LocalMediaRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);

    return Promise.all([
      getAllLibraryEntries().catch(() => []),
      getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
      getAllMediaRelations().catch(() => [] as DbMediaRelation[]),
    ]).then(([entries, catalog, relations]) => {
      if (cancelledRef.current) return;
      setRaw({ entries, catalog, relations });
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
