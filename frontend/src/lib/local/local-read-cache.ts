// Visit-scoped memo for the local reads the Local page repeats while it is
// mounted. Measured with a mocked bridge (see the report in the perf pass):
// opening one anime's panel issued get_media_relations_for_editor 17× and
// get_catalog_entry 11× (the season chain is walked by the panel's own
// season number, by the episode history hook and by resolveSeasonExternalIds
// — three walks over the same rows), reopening the same panel repeated all
// of it, and every category switch re-listed the same root folder. Same
// idea as lib/media/media-page-read-cache.ts, scoped to one Local visit:
//
//   - only active between beginLocalVisit() and endLocalVisit() (LocalLibrary's
//     mount effect) — outside a visit every reader is a plain pass-through,
//     so lib/local helpers shared with other pages never see a memoised row;
//   - cleared on the app's own write events: 'refresh-profile-library'
//     (library rows and the skeleton catalog rows a save can create),
//     'media-relations-changed', 'metadea:episode-marked' (history and the
//     progress it moved), 'media-cover-preference-changed' (folded into
//     getCatalogEntry at read time);
//   - folder listings are dropped together by invalidateLocalFolderReads(),
//     which the root refetch and the "Localizar" rename flow call;
//   - a rejected read is never retained, so a transient IPC error retries.

import {
  getMediaRelationsForEditor, getLibraryEntry, getEpisodeHistory, getAnilistPreSequelChecked,
  getCatalogEntryForEditor, getBaseEditionCandidatesForRedirect, scanFolderContents, findTaggedPath,
  getCatalogEntriesFullByIds, igdbGetGameDetail, getMediaCompanies, readGameInfo, steamGetPlayerAchievements,
  steamGetCachedAchievements, steamLang,
} from '../tauri';
import { getCatalogEntry } from '../tauri/catalog';
import type {
  DbMediaRelation, LibraryEntry, EpisodeHistoryEntry, MediaCatalogEntry, LocalFolderEntry, IgdbGame, DbMediaCompany,
  GameInfo, SteamPlayerAchievements,
} from '../tauri';
import { getLocalCatalogEntry, resolvePortRedirect, type PortRedirectReads } from '../media/port-redirect';
import { encodeExternalIdForFilename, type TaggedMatch } from './folder-match';

let visitActive = false;

let relationRows = new Map<string, Promise<DbMediaRelation[]>>();
let catalogRows = new Map<string, Promise<MediaCatalogEntry | null>>();
let editorCatalogRows = new Map<string, Promise<MediaCatalogEntry | null>>();
let fullCatalogRows = new Map<string, Promise<MediaCatalogEntry | null>>();
let baseEditionCandidates = new Map<string, Promise<string[]>>();
let libraryEntryRows = new Map<string, Promise<LibraryEntry | null>>();
let episodeHistoryRows = new Map<string, Promise<EpisodeHistoryEntry[]>>();
let preSequelChecked = new Map<string, Promise<boolean>>();
let companyRows = new Map<string, Promise<DbMediaCompany[]>>();
let folderListings = new Map<string, Promise<LocalFolderEntry[]>>();
let taggedPaths = new Map<string, Promise<TaggedMatch | null>>();
let igdbDetails = new Map<number, Promise<IgdbGame | null>>();
let gameInfoRows = new Map<string, Promise<GameInfo | null>>();
// Steam achievements, keyed "<appId>\n<steam language>": the persisted merged
// result (disk) and the live Steam fetch, memoised separately so the disk
// copy paints first and the live one only runs when it's due.
let steamCachedAchievementRows = new Map<string, Promise<SteamPlayerAchievements | null>>();
let steamLiveAchievementRows = new Map<string, Promise<SteamPlayerAchievements | null>>();
// A cache fetched before this instant is due a live refresh regardless of
// its age (see markLocalSteamAchievementsStale). Survives visits on purpose.
let steamAchievementsForcedAfterMs = 0;

export type { SteamPlayerAchievements };

export function beginLocalVisit(): void {
  visitActive = true;
  invalidateLocalReads();
}

export function endLocalVisit(): void {
  visitActive = false;
  invalidateLocalReads();
}

export function isLocalVisitActive(): boolean {
  return visitActive;
}

export function invalidateLocalReads(): void {
  relationRows = new Map();
  catalogRows = new Map();
  editorCatalogRows = new Map();
  fullCatalogRows = new Map();
  baseEditionCandidates = new Map();
  libraryEntryRows = new Map();
  episodeHistoryRows = new Map();
  preSequelChecked = new Map();
  companyRows = new Map();
  folderListings = new Map();
  taggedPaths = new Map();
  igdbDetails = new Map();
  gameInfoRows = new Map();
  dropSteamAchievementRows();
  namespaced = new Map();
}

// The per-app_id metadata a fetch or an IGDB re-link rewrites (info.json
// and the Steam achievements cache) — called after "Obtener metadatos"
// and after the picker relinks a game, before the caller's own refresh.
export function invalidateLocalGameReads(): void {
  gameInfoRows = new Map();
  dropSteamAchievementRows();
}

// One game's Steam achievements, right after steam_achievements_download
// rewrote them — and their disk cache (see lib/local/metadata-fetch.ts).
export function invalidateLocalSteamAchievements(appId: number): void {
  dropSteamAchievementRows(appId);
}

// Every persisted Steam achievements copy read so far is due a live refresh
// on its next open, whatever its age — after a play session.
export function markLocalSteamAchievementsStale(): void {
  dropSteamAchievementRows();
  steamAchievementsForcedAfterMs = Date.now();
}

function dropSteamAchievementRows(appId?: number): void {
  if (appId === undefined) {
    steamCachedAchievementRows = new Map();
    steamLiveAchievementRows = new Map();
    return;
  }
  const prefix = `${appId}\n`;
  for (const map of [steamCachedAchievementRows, steamLiveAchievementRows]) {
    for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key);
  }
}

// Every folder listing and tagged-path walk — after a rename, or when the
// root is explicitly refetched.
export function invalidateLocalFolderReads(): void {
  folderListings = new Map();
  taggedPaths = new Map();
}

export function invalidateLocalEpisodeHistory(externalId?: string): void {
  if (externalId === undefined) episodeHistoryRows = new Map();
  else episodeHistoryRows.delete(externalId);
}

function invalidateLibraryReads(): void {
  libraryEntryRows = new Map();
  // A library write also follows every play session (the auto-tracked
  // playtime save), which is exactly when Steam may report new unlocks.
  markLocalSteamAchievementsStale();
  catalogRows = new Map();
  editorCatalogRows = new Map();
  fullCatalogRows = new Map();
}

function invalidateRelationReads(): void {
  relationRows = new Map();
  baseEditionCandidates = new Map();
  preSequelChecked = new Map();
}

function invalidateCatalogReads(): void {
  catalogRows = new Map();
  editorCatalogRows = new Map();
  fullCatalogRows = new Map();
}

function memo<K, V>(map: Map<K, Promise<V>>, key: K, read: () => Promise<V>): Promise<V> {
  if (!visitActive) return read();
  const hit = map.get(key);
  if (hit) return hit;
  const pending = read();
  map.set(key, pending);
  pending.catch(() => { if (map.get(key) === pending) map.delete(key); });
  return pending;
}

export function readLocalRelationsForEditor(mediaExternalId: string): Promise<DbMediaRelation[]> {
  return memo(relationRows, mediaExternalId, () => getMediaRelationsForEditor(mediaExternalId));
}

export function readLocalCatalogEntry(externalId: string): Promise<MediaCatalogEntry | null> {
  return memo(catalogRows, externalId, () => getCatalogEntry(externalId));
}

export function readLocalCatalogEntryForEditor(externalId: string): Promise<MediaCatalogEntry | null> {
  return memo(editorCatalogRows, externalId, () => getCatalogEntryForEditor(externalId));
}

export function readLocalBaseEditionCandidates(mediaExternalId: string): Promise<string[]> {
  return memo(baseEditionCandidates, mediaExternalId, () => getBaseEditionCandidatesForRedirect(mediaExternalId));
}

export function readLocalLibraryEntry(externalId: string): Promise<LibraryEntry | null> {
  return memo(libraryEntryRows, externalId, () => getLibraryEntry(externalId));
}

export function readLocalEpisodeHistory(externalId: string): Promise<EpisodeHistoryEntry[]> {
  return memo(episodeHistoryRows, externalId, () => getEpisodeHistory(externalId));
}

export function readLocalAnilistPreSequelChecked(externalId: string): Promise<boolean> {
  return memo(preSequelChecked, externalId, () => getAnilistPreSequelChecked(externalId));
}

export function readLocalMediaCompanies(mediaExternalId: string): Promise<DbMediaCompany[]> {
  return memo(companyRows, mediaExternalId, () => getMediaCompanies(mediaExternalId));
}

export function readLocalFolderContents(path: string): Promise<LocalFolderEntry[]> {
  return memo(folderListings, path, () => scanFolderContents(path));
}

// The "[external_id]"-tagged folder/file under rootFolder — one Rust-side
// walk (find_tagged_path) instead of folder-match.ts's one-IPC-per-directory
// recursion, memoised per (root, id) for the visit.
export function readLocalTaggedPath(rootFolder: string, externalId: string, maxDepth = 3): Promise<TaggedMatch | null> {
  const tag = `[${encodeExternalIdForFilename(externalId)}]`;
  return memo(taggedPaths, `${rootFolder}\n${externalId}\n${maxDepth}`, () =>
    findTaggedPath(rootFolder, tag, maxDepth).then(found => found ? { absPath: found.abs_path, isDir: found.is_dir } : null));
}

// Full media_catalog rows by id: ids the visit hasn't memoised yet are
// fetched in ONE get_catalog_entries_full_by_ids call. Unknown ids resolve
// to null; a failed batch resolves every requested id to null for this call
// without retaining anything.
export async function readLocalFullCatalogEntries(ids: readonly string[]): Promise<Map<string, MediaCatalogEntry | null>> {
  const unique = [...new Set(ids)];
  const missing = unique.filter(id => !visitActive || !fullCatalogRows.has(id));
  if (missing.length > 0) {
    const batch = getCatalogEntriesFullByIds(missing).then(rows => new Map(rows.map(row => [row.external_id, row])));
    for (const id of missing) memo(fullCatalogRows, id, () => batch.then(rows => rows.get(id) ?? null));
    if (!visitActive) {
      const rows = await batch.catch(() => new Map<string, MediaCatalogEntry>());
      return new Map(unique.map(id => [id, rows.get(id) ?? null]));
    }
  }
  const out = new Map<string, MediaCatalogEntry | null>();
  await Promise.all(unique.map(id => memo(fullCatalogRows, id, () => getCatalogEntriesFullByIds([id]).then(rows => rows[0] ?? null))
    .then(row => { out.set(id, row); }, () => { out.set(id, null); })));
  return out;
}

// A visit-scoped memo for a read this module doesn't wrap itself (the
// provider-sourced episode names, whose loader lives in lib/media) — one
// bucket per namespace, dropped with everything else when the visit ends.
let namespaced = new Map<string, Map<string, Promise<unknown>>>();

export function memoLocalRead<V>(namespace: string, key: string, read: () => Promise<V>): Promise<V> {
  if (!visitActive) return read();
  let bucket = namespaced.get(namespace);
  if (!bucket) {
    bucket = new Map();
    namespaced.set(namespace, bucket);
  }
  return memo(bucket as Map<string, Promise<V>>, key, read);
}

// A live IGDB detail, memoised for the visit: usePendingLaunchers asks for
// the same planning games on every grid rebuild, and IGDB's answer for a
// given id doesn't change within one visit.
export function readLocalIgdbGameDetail(igdbId: number): Promise<IgdbGame | null> {
  return memo(igdbDetails, igdbId, () => igdbGetGameDetail(igdbId));
}

// A game's cached info.json (read_game_info) — GameDetailPanel repeated it
// on every reopen. Only changes through a metadata fetch or a re-link, both
// of which invalidate it above.
export function readLocalGameInfo(appId: string): Promise<GameInfo | null> {
  return memo(gameInfoRows, appId, () => readGameInfo(appId));
}

// A live refresh is skipped while the persisted copy is younger than this.
export const STEAM_ACHIEVEMENTS_FRESH_MS = 10 * 60 * 1000;

// Whether a persisted Steam achievements result can stand in for a live
// fetch: younger than STEAM_ACHIEVEMENTS_FRESH_MS, not older than the last
// forced invalidation, and fetched after the game was last played (Steam
// stamps last_played at launch, so a session started since means unlocks
// the cache can't know about).
export function isSteamAchievementsCacheFresh(
  fetchedAtSec: number | undefined,
  nowMs: number,
  forcedAfterMs = 0,
  lastPlayedSec?: number,
): boolean {
  if (!fetchedAtSec) return false;
  const fetchedAtMs = fetchedAtSec * 1000;
  if (fetchedAtMs < forcedAfterMs) return false;
  if (lastPlayedSec && fetchedAtSec < lastPlayedSec) return false;
  const age = nowMs - fetchedAtMs;
  return age >= 0 && age < STEAM_ACHIEVEMENTS_FRESH_MS;
}

// Same unlocks, names and icons — `fetched_at` alone changing is no reason
// to re-render the grid.
export function sameSteamAchievements(a: SteamPlayerAchievements, b: SteamPlayerAchievements): boolean {
  return a.unlocked === b.unlocked && a.total === b.total && JSON.stringify(a.list) === JSON.stringify(b.list);
}

// Disk only (the persisted merged result, or the metadata download).
export function readLocalSteamCachedAchievements(appId: number, lang = steamLang()): Promise<SteamPlayerAchievements | null> {
  return memo(steamCachedAchievementRows, `${appId}\n${lang}`, () => steamGetCachedAchievements(appId, lang));
}

// Warms the disk read for a card the user is about to open (hover/selection
// in the Local grid). Never touches the network; a no-op outside a visit,
// where nothing would keep the result.
export function prefetchLocalSteamAchievements(appId: number): void {
  if (!visitActive || !Number.isFinite(appId) || appId <= 0) return;
  void readLocalSteamCachedAchievements(appId).catch(() => {});
}

// Stale-while-revalidate for the detail panel: `onData` gets the persisted
// copy as soon as it's read, then the live Steam result only if it differs
// (or `null` when there is neither). The live fetch is skipped while the
// persisted copy is fresh (isSteamAchievementsCacheFresh) and memoised for
// the visit, so a reopen is a pure memory read.
export async function loadLocalSteamAchievements(
  appId: number,
  onData: (data: SteamPlayerAchievements | null) => void,
  options: { lastPlayedSec?: number; nowMs?: number } = {},
): Promise<void> {
  const lang = steamLang();
  const key = `${appId}\n${lang}`;
  const cached = await readLocalSteamCachedAchievements(appId, lang).catch(() => null);
  if (cached) onData(cached);
  const nowMs = options.nowMs ?? Date.now();
  if (cached && isSteamAchievementsCacheFresh(cached.fetched_at, nowMs, steamAchievementsForcedAfterMs, options.lastPlayedSec)) return;

  const live = await memo(steamLiveAchievementRows, key, () => steamGetPlayerAchievements(appId, lang).then(result => {
    // The next disk read would return exactly this; skip it.
    if (result && visitActive) steamCachedAchievementRows.set(key, Promise.resolve(result));
    return result;
  })).catch(() => null);
  if (live) {
    if (!cached || !sameSteamAchievements(cached, live)) onData(live);
  } else if (!cached) {
    onData(null);
  }
}

// lib/media/port-redirect's walks, fed from this visit's memoised rows:
// GameDetailPanel resolves the same PORT/blocked chain for the header, for
// the edit target and again on "editar", and each hop used to be its own
// get_catalog_entry_for_editor / get_base_edition_candidates pair.
const localPortRedirectReads: PortRedirectReads = {
  getCatalogEntryForEditor: readLocalCatalogEntryForEditor,
  getBaseEditionCandidatesForRedirect: readLocalBaseEditionCandidates,
  getCatalogEntry: readLocalCatalogEntry,
};

export function readLocalPortRedirect(externalId: string): Promise<string | null> {
  return resolvePortRedirect(externalId, localPortRedirectReads);
}

export function readLocalCatalogEntryPastRedirect(externalId: string): Promise<MediaCatalogEntry | null> {
  return getLocalCatalogEntry(externalId, localPortRedirectReads);
}

if (typeof window !== 'undefined') {
  window.addEventListener('refresh-profile-library', invalidateLibraryReads);
  window.addEventListener('media-relations-changed', invalidateRelationReads);
  window.addEventListener('media-cover-preference-changed', invalidateCatalogReads);
  window.addEventListener('metadea:episode-marked', () => {
    invalidateLocalEpisodeHistory();
    libraryEntryRows = new Map();
  });
}
