import { getAllLibraryEntries } from '../tauri/library';
import { getCatalogEntriesForLibrary, getCatalogEntriesByIds } from '../tauri/catalog';
import type { LibraryEntry, CatalogSummary, DbMediaRelation } from '../tauri';
import { collectSeedIds, loadScopedMediaRelations } from './relations-scope';

export interface LibraryAndCatalog {
  items: LibraryEntry[];
  // The catalog rows the profile/home views render cards for — library,
  // lists/favourites, monthly history, activity journey (see
  // getCatalogEntriesForLibrary) — plus every row the scoped relations walk
  // reached (a bundle container or edition base that isn't in the library
  // still becomes the visible card, so it needs its title and cover). In
  // the CatalogSummary projection; a view that needs a row outside that set
  // fetches it by id itself.
  catalog: CatalogSummary[];
}

interface ProfileData extends LibraryAndCatalog {
  relations: DbMediaRelation[];
}

// Module-level cache to avoid redundant IPC round trips across profile tabs.
// Invalidated only when real mutations happen (library editor, relation
// writes). One chain: library + scoped catalog → scoped relations (the
// second-largest payload; every consumer used to fetch its own copy) →
// catalog rows for the ids those relations introduced.
let profileCache: Promise<ProfileData> | null = null;

/** Ids on either end of `relations` that have no catalog row yet. */
export function collectMissingCatalogIds(
  relations: readonly DbMediaRelation[],
  catalog: ReadonlyArray<{ external_id: string }>,
): string[] {
  const known = new Set(catalog.map(row => row.external_id));
  const out: string[] = [];
  const consider = (id: string | undefined) => {
    if (!id || known.has(id)) return;
    known.add(id);
    out.push(id);
  };
  for (const relation of relations) {
    consider(relation.media_external_id);
    consider(relation.related_media_external_id);
  }
  return out;
}

function loadProfileData(): Promise<ProfileData> {
  // A failed load (e.g. a command missing from the ACL) must not be memoised
  // as "empty library": log it so it is diagnosable, return the fallback for
  // this render, and let the next caller retry.
  return Promise.all([
    getAllLibraryEntries().catch((err) => { logLoadFailure('library', err); profileCache = null; return [] as LibraryEntry[]; }),
    getCatalogEntriesForLibrary().catch((err) => { logLoadFailure('catalog', err); profileCache = null; return [] as CatalogSummary[]; }),
  ]).then(async ([items, catalog]) => {
    const relations = await loadScopedMediaRelations(collectSeedIds(items, catalog));
    const missing = collectMissingCatalogIds(relations, catalog);
    const extra = missing.length === 0
      ? []
      : await getCatalogEntriesByIds(missing).catch((err) => { logLoadFailure('related catalog rows', err); return [] as CatalogSummary[]; });
    return { items, catalog: extra.length === 0 ? catalog : [...catalog, ...extra], relations };
  });
}

function getCachedProfileData(): Promise<ProfileData> {
  if (!profileCache) profileCache = loadProfileData();
  return profileCache;
}

export function getCachedLibraryAndCatalog(): Promise<LibraryAndCatalog> {
  return getCachedProfileData().then(({ items, catalog }) => ({ items, catalog }));
}

export function getCachedMediaRelations(): Promise<DbMediaRelation[]> {
  return getCachedProfileData().then(({ relations }) => relations);
}

function logLoadFailure(what: string, err: unknown) {
  console.error(`[library-data-cache] failed to load ${what}:`, err);
}

function invalidateProfileDataCaches() {
  profileCache = null;
}

if (typeof window !== 'undefined') {
  window.addEventListener('refresh-profile-library', invalidateProfileDataCaches);
  // Fired by lib/tauri/catalog.ts after any relations write — see
  // notifyMediaRelationsChanged there. Relations decide which extra catalog
  // rows are needed, so the whole bundle reloads.
  window.addEventListener('media-relations-changed', invalidateProfileDataCaches);
}
