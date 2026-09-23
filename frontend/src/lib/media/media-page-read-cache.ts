// Visit-scoped memo for the local reads the media page repeats while one
// /media?id=… view is mounted. Measured on an anime with a three-season
// chain, one page open used to issue get_media_relations 20× and
// get_catalog_entry 17× (the prequel/sequel chain walk alone ran four times:
// episode offset, episode mapping key, theme offsets, and the hook's own
// offset read), all returning identical rows. Same idea as
// lib/profile/library-data-cache.ts, but scoped to one page visit:
//
//   - only active between beginMediaPageVisit() and endMediaPageVisit()
//     (useMediaPageData's load effect) — outside a visit every reader is a
//     plain pass-through, so other pages that share these helpers never see
//     a memoised row;
//   - the visit's own id is served from ONE get_media_page_bundle round trip
//     (lib/tauri/media-page.ts) started by beginMediaPageVisit: the catalog
//     row, relations, authors, characters, staff, companies, sync state,
//     library entry, cached episodes and themes all come out of that single
//     response instead of ten separate commands. Any other id (a parent
//     game, a chain member) still goes through its own command, memoised;
//   - cleared on the existing write events (media-relations-changed,
//     refresh-profile-library, media-cover-preference-changed) and by
//     invalidateMediaPageReads(), which the media page's own catalog writes
//     call right after they land — the next read of the visit's id then
//     fetches a fresh bundle once. A per-part write (saveMediaEpisodes,
//     saveMediaAuthors, … — see lib/tauri/change-events.ts) only marks that
//     part stale, so it is re-read on its own without refetching the rest;
//   - a rejected read is never retained, so a transient IPC error retries;
//     a rejected bundle makes every part fall back to its own command.
import {
  getCatalogEntry, getMediaRelations, getMediaRelationsForIds, getBlockedExternalIds, getMediaAuthors,
  getMediaCharacters, getMediaStaff, getMediaCompanies, getSyncState, getLibraryEntry, getMediaEpisodes,
  getMediaThemes, getMediaPageBundle, getAnimeChain,
} from '../tauri';
import { groupByOwner } from '../shared/collections/batch';
import type {
  MediaCatalogEntry, DbMediaRelation, DbMediaAuthor, DbMediaCharacter, DbMediaStaffMember, DbMediaCompany,
  SyncStateEntry, LibraryEntry, MediaEpisode, MediaTheme, MediaPageBundle, AnimeChainRow,
} from '../tauri';
import { MEDIA_PART_CHANGED_EVENT, type MediaPagePart, type MediaPartChangedDetail } from '../tauri/change-events';

type BundlePart = keyof MediaPageBundle;

let activeVisitId: string | null = null;
let bundle: Promise<MediaPageBundle | null> | null = null;
// Parts a write has invalidated since the bundle was fetched — served by
// their own command (memoised) instead of the bundle's now-stale copy.
let staleParts = new Set<BundlePart>();

let catalogRows = new Map<string, Promise<MediaCatalogEntry | null>>();
let relationRows = new Map<string, Promise<DbMediaRelation[]>>();
let authorRows = new Map<string, Promise<DbMediaAuthor[]>>();
let characterRows = new Map<string, Promise<DbMediaCharacter[]>>();
let staffRows = new Map<string, Promise<DbMediaStaffMember[]>>();
let companyRows = new Map<string, Promise<DbMediaCompany[]>>();
let syncStateRows = new Map<string, Promise<SyncStateEntry | null>>();
let libraryEntryRows = new Map<string, Promise<LibraryEntry | null>>();
let episodeRows = new Map<string, Promise<MediaEpisode[]>>();
let themeRows = new Map<string, Promise<MediaTheme[]>>();
let animeChainRows = new Map<string, Promise<AnimeChainRow[]>>();
let blockedIds: Promise<string[]> | null = null;

export function invalidateMediaPageReads(): void {
  bundle = null;
  staleParts = new Set();
  catalogRows = new Map();
  relationRows = new Map();
  authorRows = new Map();
  characterRows = new Map();
  staffRows = new Map();
  companyRows = new Map();
  syncStateRows = new Map();
  libraryEntryRows = new Map();
  episodeRows = new Map();
  themeRows = new Map();
  animeChainRows = new Map();
  blockedIds = null;
}

export function beginMediaPageVisit(currentId: string): void {
  activeVisitId = currentId;
  invalidateMediaPageReads();
  // Kick the bundle off now so the reads that fire in the same tick
  // (catalog row, episodes/themes seeds, blocked ids) all share it.
  bundleFor(currentId);
}

export function endMediaPageVisit(currentId: string): void {
  if (activeVisitId !== currentId) return;
  activeVisitId = null;
  invalidateMediaPageReads();
}

export function isMediaPageVisitActive(): boolean {
  return activeVisitId !== null;
}

function memo<K, V>(map: Map<K, Promise<V>>, key: K, read: () => Promise<V>): Promise<V> {
  const hit = map.get(key);
  if (hit) return hit;
  const pending = read();
  map.set(key, pending);
  pending.catch(() => { if (map.get(key) === pending) map.delete(key); });
  return pending;
}

// The visit's bundle, fetched at most once per (visit, invalidation). Only
// ever called for the active visit's own id. A failed fetch resolves to
// null so every part quietly falls back to its own command.
function bundleFor(currentId: string): Promise<MediaPageBundle | null> {
  if (!bundle) bundle = getMediaPageBundle(currentId).catch(() => null);
  return bundle;
}

function readPart<K extends BundlePart>(
  part: K,
  map: Map<string, Promise<MediaPageBundle[K]>>,
  externalId: string,
  read: () => Promise<MediaPageBundle[K]>,
): Promise<MediaPageBundle[K]> {
  if (activeVisitId === null) return read();
  return memo(map, externalId, () => {
    if (externalId !== activeVisitId || staleParts.has(part)) return read();
    return bundleFor(externalId).then(loaded => loaded ? loaded[part] : read());
  });
}

// A per-media write landed (see lib/tauri/change-events.ts): that part is
// re-read through its own command from now on, everything else keeps the
// bundle's copy. Wired to the window event below; exported for tests.
export function markMediaPagePartStale(part: MediaPagePart): void {
  staleParts.add(part);
  switch (part) {
    case 'authors': authorRows = new Map(); break;
    case 'characters': characterRows = new Map(); break;
    case 'staff': staffRows = new Map(); break;
    case 'companies': companyRows = new Map(); break;
    case 'episodes': episodeRows = new Map(); break;
    case 'themes': themeRows = new Map(); break;
    case 'sync_state': syncStateRows = new Map(); break;
  }
}

export function readCatalogEntryCached(externalId: string): Promise<MediaCatalogEntry | null> {
  return readPart('catalog', catalogRows, externalId, () => getCatalogEntry(externalId));
}

export function readMediaRelationsCached(mediaExternalId: string): Promise<DbMediaRelation[]> {
  return readPart('relations', relationRows, mediaExternalId, () => getMediaRelations(mediaExternalId));
}

// Relation rows for several ids at once — the same buckets as one
// readMediaRelationsCached per id, in `ids` order, but ids the visit hasn't
// memoised yet are fetched in ONE get_media_relations_for_ids call (and
// memoised, so later per-id reads of the same ids are free). A failed
// batch resolves those ids to [] for this call without retaining anything.
export async function readMediaRelationsBatchCached(ids: readonly string[]): Promise<Map<string, DbMediaRelation[]>> {
  const unique = [...new Set(ids)];
  const rows = new Map<string, DbMediaRelation[]>();
  const pending: Promise<void>[] = [];
  const missing: string[] = [];
  for (const id of unique) {
    const memoised = activeVisitId !== null
      ? (relationRows.get(id) ?? (id === activeVisitId ? readMediaRelationsCached(id) : null))
      : null;
    if (memoised) pending.push(memoised.then(list => { rows.set(id, list); }, () => { rows.set(id, []); }));
    else missing.push(id);
  }
  if (missing.length > 0) {
    const batch = getMediaRelationsForIds(missing).then(all => groupByOwner(all, row => row.media_external_id, missing));
    if (activeVisitId !== null) {
      for (const id of missing) memo(relationRows, id, () => batch.then(grouped => grouped.get(id) ?? []));
    }
    pending.push(batch.then(
      grouped => { for (const id of missing) rows.set(id, grouped.get(id) ?? []); },
      () => { for (const id of missing) rows.set(id, []); },
    ));
  }
  await Promise.all(pending);
  return new Map(unique.map(id => [id, rows.get(id) ?? []]));
}

export function readMediaAuthorsCached(mediaExternalId: string): Promise<DbMediaAuthor[]> {
  return readPart('authors', authorRows, mediaExternalId, () => getMediaAuthors(mediaExternalId));
}

// image_url is a loadable URL either way (a data URL from get_media_characters,
// an asset URL from the bundle) — display only, never write it back.
export function readMediaCharactersCached(mediaExternalId: string): Promise<DbMediaCharacter[]> {
  return readPart('characters', characterRows, mediaExternalId, () => getMediaCharacters(mediaExternalId));
}

export function readMediaStaffCached(mediaExternalId: string): Promise<DbMediaStaffMember[]> {
  return readPart('staff', staffRows, mediaExternalId, () => getMediaStaff(mediaExternalId));
}

export function readMediaCompaniesCached(mediaExternalId: string): Promise<DbMediaCompany[]> {
  return readPart('companies', companyRows, mediaExternalId, () => getMediaCompanies(mediaExternalId));
}

export function readSyncStateCached(externalId: string): Promise<SyncStateEntry | null> {
  return readPart('sync_state', syncStateRows, externalId, () => getSyncState(externalId));
}

export function readLibraryEntryCached(externalId: string): Promise<LibraryEntry | null> {
  return readPart('library_entry', libraryEntryRows, externalId, () => getLibraryEntry(externalId));
}

export function readMediaEpisodesCached(externalId: string): Promise<MediaEpisode[]> {
  return readPart('episodes', episodeRows, externalId, () => getMediaEpisodes(externalId));
}

export function readMediaThemesCached(externalId: string): Promise<MediaTheme[]> {
  return readPart('themes', themeRows, externalId, () => getMediaThemes(externalId));
}

// The PREQUEL/SEQUEL chain is computed in Rust from the relation rows, so it
// is dropped together with them on every relations write.
export function readAnimeChainCached(externalId: string): Promise<AnimeChainRow[]> {
  if (activeVisitId === null) return getAnimeChain(externalId);
  return memo(animeChainRows, externalId, () => getAnimeChain(externalId));
}

export function readBlockedExternalIdsCached(): Promise<string[]> {
  if (activeVisitId === null) return getBlockedExternalIds();
  if (!blockedIds) {
    const pending = getBlockedExternalIds();
    blockedIds = pending;
    pending.catch(() => { if (blockedIds === pending) blockedIds = null; });
  }
  return blockedIds;
}

if (typeof window !== 'undefined') {
  // Fired by lib/tauri/catalog.ts after any relations write and by
  // lib/tauri/library.ts after library writes (a library save can create a
  // skeleton catalog row); cover preferences are folded into getCatalogEntry
  // at read time, so a change there must drop the memoised rows too.
  for (const event of ['media-relations-changed', 'refresh-profile-library', 'media-cover-preference-changed']) {
    window.addEventListener(event, invalidateMediaPageReads);
  }
  window.addEventListener(MEDIA_PART_CHANGED_EVENT, event => {
    markMediaPagePartStale((event as CustomEvent<MediaPartChangedDetail>).detail.part);
  });
}
