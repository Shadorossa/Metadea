// "Import from MyAnimeList": the user's MAL anime/manga lists → library
// entries, through the same merge the AniList importer uses
// (lib/anilist/import.ts mergeAniListItemsIntoLibrary), since Metadea keys
// works by AniList id. Matching a MAL id to an AniList work goes:
//   1. catalog rows that already carry that mal_id (one local query), then
//   2. AniList's `idMal_in` lookup in batches for the rest, whose answers
//      are written back to media_catalog.mal_id so the next import (and
//      AniSkip, and the save-time sync) never ask again.
// Items AniList does not know come back in `unmatched` for the summary.
import {
  malFetchList, malCatalogLinksByMalIds, malRememberCatalogLinks,
  type MalCatalogLink, type MalListItem, type MalListKind,
} from '../tauri/mal';
import { fetchAniListMediaByMalIds, type AniListMediaByMalId } from '../search/providers/anilist/detail';
import {
  mergeAniListItemsIntoLibrary, type AniListImportMediaItem, type ImportProgress, type LibraryMergeResult,
} from '../anilist/import';
import { getT } from '../../i18n/runtime';
import { errorMessage } from '../errors/format-error';
import { importMediaStubForKnownRow, malListItemToImportItem } from './mapping';

export interface MalImportResult extends Partial<LibraryMergeResult> {
  ok: boolean;
  error?: string;
  /** Rows of the MAL list with no AniList counterpart (not imported). */
  unmatched?: MalListItem[];
}

export interface MalImportPlan {
  items: AniListImportMediaItem[];
  unmatched: MalListItem[];
  /** Fresh MAL id ↔ catalog row pairs learned from AniList this run. */
  newLinks: MalCatalogLink[];
}

const ANILIST_TYPE: Record<MalListKind, 'ANIME' | 'MANGA'> = { anime: 'ANIME', manga: 'MANGA' };

// Pure: MAL rows + what the catalog already knows + what AniList answered
// → the items to merge, the rows nothing matched and the links to persist.
export function planMalImport(
  kind: MalListKind,
  rows: MalListItem[],
  knownLinks: MalCatalogLink[],
  anilistMatches: AniListMediaByMalId[],
): MalImportPlan {
  const known = new Map(knownLinks.map(link => [link.mal_id, link]));
  const fromAniList = new Map<number, AniListMediaByMalId>();
  for (const media of anilistMatches) {
    if (typeof media.idMal === 'number' && !fromAniList.has(media.idMal)) fromAniList.set(media.idMal, media);
  }

  const items: AniListImportMediaItem[] = [];
  const unmatched: MalListItem[] = [];
  const newLinks: MalCatalogLink[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.mal_id)) continue;
    seen.add(row.mal_id);

    const link = known.get(row.mal_id);
    const stub = link ? importMediaStubForKnownRow(link.external_id, link.type) : null;
    if (stub) {
      items.push(malListItemToImportItem(row, stub));
      continue;
    }
    const media = fromAniList.get(row.mal_id);
    if (!media) {
      unmatched.push(row);
      continue;
    }
    items.push(malListItemToImportItem(row, media));
    const base = kind === 'anime' ? 'anime' : media.format?.toUpperCase() === 'NOVEL' ? 'lnovel' : 'manga';
    newLinks.push({ mal_id: row.mal_id, external_id: `${base}:${media.id}`, type: base });
  }
  return { items, unmatched, newLinks };
}

export interface MalImportDeps {
  fetchList: (kind: MalListKind) => Promise<MalListItem[]>;
  knownLinks: (kind: MalListKind, malIds: number[]) => Promise<MalCatalogLink[]>;
  lookupAniList: (malIds: number[], type: 'ANIME' | 'MANGA') => Promise<AniListMediaByMalId[]>;
  merge: (items: AniListImportMediaItem[], onProg: (p: ImportProgress) => void) => Promise<LibraryMergeResult>;
  rememberLinks: (links: MalCatalogLink[]) => Promise<number>;
}

const defaultDeps: MalImportDeps = {
  fetchList: malFetchList,
  knownLinks: malCatalogLinksByMalIds,
  lookupAniList: fetchAniListMediaByMalIds,
  merge: mergeAniListItemsIntoLibrary,
  rememberLinks: malRememberCatalogLinks,
};

export async function importMalList(
  kinds: MalListKind[],
  onProgress?: (progress: ImportProgress) => void,
  deps: MalImportDeps = defaultDeps,
): Promise<MalImportResult> {
  const onProg = onProgress ?? (() => {});
  if (kinds.length === 0) return { ok: true, updated: 0, added: 0, failed: 0, unmatched: [] };
  const t = getT().mal;

  try {
    const items: AniListImportMediaItem[] = [];
    const unmatched: MalListItem[] = [];
    const newLinks: MalCatalogLink[] = [];

    for (const kind of kinds) {
      onProg({ current: 0, total: 0, status: 'loading', message: t.import_fetching.replace('{kind}', kind === 'anime' ? t.kind_anime : t.kind_manga) });
      const rows = await deps.fetchList(kind);
      if (rows.length === 0) continue;

      const malIds = rows.map(row => row.mal_id);
      const known = await deps.knownLinks(kind, malIds);
      const knownIds = new Set(known.map(link => link.mal_id));
      const toLookUp = malIds.filter(id => !knownIds.has(id));

      onProg({ current: 0, total: rows.length, status: 'loading', message: t.import_matching.replace('{count}', String(toLookUp.length)) });
      const matches = toLookUp.length ? await deps.lookupAniList(toLookUp, ANILIST_TYPE[kind]) : [];

      const plan = planMalImport(kind, rows, known, matches);
      items.push(...plan.items);
      unmatched.push(...plan.unmatched);
      newLinks.push(...plan.newLinks);
    }

    onProg({ current: 0, total: items.length, status: 'importing', message: t.import_saving.replace('{count}', String(items.length)) });
    const merged = await deps.merge(items, onProg);
    // After the merge, so the catalog rows the merge just created exist to
    // be stamped. A failure here only costs a lookup next time.
    await deps.rememberLinks(newLinks).catch(err => console.warn('Could not persist MAL ids:', err));

    onProg({ current: items.length, total: items.length, status: 'done', failed: merged.failed });
    return { ok: true, ...merged, unmatched };
  } catch (err) {
    const message = errorMessage(err);
    onProg({ current: 0, total: 0, status: 'error', message });
    return { ok: false, error: message };
  }
}
