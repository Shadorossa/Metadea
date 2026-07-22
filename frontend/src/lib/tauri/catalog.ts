import { invoke, tauriCmd, tauriRun, isTauri } from './core';

export interface MediaCatalogEntry {
  id:                   string;
  external_id:          string;
  authors_csv?:         string | null;
  banners_csv?:         string | null;
  /** Set via PrEditorModal to reserve this external_id (so it can never be
   *  re-added as "new" from a live search result) while hiding the row
   *  everywhere else — search, relations, saga chains — for remasters/
   *  editions the curator considers unwanted noise. Proposed to GitHub like
   *  any other collaborative-catalog field (see submitCollaborativeProposal.ts),
   *  so a block reaches every other user's install once merged. */
  blocked_at?:          string | null;
  /** ISO-ish country code (AniList countryOfOrigin / TMDB origin_country) —
   *  persisted so the catalog-only fast path can show "País de origen"
   *  without a live fetch. */
  country_code?:        string | null;
  cover_url?:           string | null;
  /** Lead developer name, overlaid on a game's banner (IGDB only) — same
   *  "persist so the fast path has it too" reasoning as source_url. */
  developer_badge?:     string | null;
  favorites_count?:     number | null;
  format?:              string | null;
  genres_csv?:          string | null;
  genres_tag_csv?:      string | null;
  last_sync_error?:     string | null;
  last_synced_at?:      string | null;
  parent_id?:           string | null;
  platforms_csv?:       string | null;
  /** Publisher subset of companies_cache_csv (IGDB only) — kept separate
   *  since a company can be both developer and publisher, which the merged
   *  companies_cache_csv can't tell apart once flattened. */
  publishers_csv?:      string | null;
  ratings_count?:       number | null;
  release_day?:         number | null;
  /** AniList raw.endDate — persisted so the catalog-only fast path can
   *  rebuild the "start - end" dateBadge range instead of just the start. */
  release_end_day?:     number | null;
  release_end_month?:   number | null;
  release_end_year?:    number | null;
  release_month?:       number | null;
  release_year?:        number | null;
  score_global?:        number | null;
  /** CSV of "platform|url" pairs — IGDB's store links (Steam, GOG, ...) for this game. */
  shop_links_csv?:      string | null;
  source?:              string | null;
  /** This work's own page on its source provider's website — recomputed on
   *  every live fetch, but persisted too so the catalog-only fast path
   *  (most visits — see mediaService.ts/needsResync) can still show the
   *  source logo/link without one. */
  source_url?:          string | null;
  status?:              string | null;
  sync_failed_count?:   number | null;
  synopsis?:            string | null;
  time_length?:         number | null;
  /** Display-only alternate title (AniList title.english) — no other
   *  purpose than showing up in the fast path without a live fetch. */
  title_english?:       string | null;
  title_main?:          string | null;
  /** Title in its original-language script (e.g. Japanese kanji/kana) — see
   *  MediaPageData.titleNative. */
  title_native?:        string | null;
  /** Romanized title, when the source provider actually has one (AniList,
   *  IGDB's alternative_names) — see MediaPageData.titleRomaji. */
  title_romaji?:        string | null;
  total_count?:         number | null;
  total_count_2?:       number | null;
  type:                 string;
  created_at:           string;
  updated_at:           string;
}

export async function saveCatalogEntry(entry: MediaCatalogEntry): Promise<MediaCatalogEntry> {
  if (!isTauri()) throw new Error('Tauri not available');
  return invoke<MediaCatalogEntry>('save_catalog_entry', { entry });
}

export async function getCatalogEntry(externalId: string): Promise<MediaCatalogEntry | null> {
  return tauriCmd<MediaCatalogEntry | null>('get_catalog_entry', null, { externalId });
}

// Used to filter a live API fetch's raw relations/recommendations — the
// provider has no idea a related title was blocked (hidden) locally via the
// collaborative-catalog editor, so this must be checked client-side before
// ever showing such a title anywhere on the page.
export async function getBlockedExternalIds(): Promise<string[]> {
  return tauriCmd<string[]>('get_blocked_external_ids', []);
}

export async function deleteCatalogEntry(externalId: string): Promise<void> {
  return tauriRun('delete_catalog_entry', { externalId });
}

export async function markCatalogSyncFailed(externalId: string, error: string): Promise<void> {
  return tauriRun('mark_catalog_sync_failed', { externalId, error });
}

export async function updateCatalogGenres(externalId: string, genresCsv: string | null, genresTagCsv: string | null): Promise<void> {
  return tauriRun('update_catalog_genres', { externalId, genresCsv, genresTagCsv });
}

export async function getAllCatalogEntries(): Promise<MediaCatalogEntry[]> {
  return tauriCmd<MediaCatalogEntry[]>('get_all_catalog_entries', []);
}

export interface CatalogHealthEntry {
  external_id: string;
  title_main: string;
  type: string;
}

export interface CatalogHealthReport {
  orphans: CatalogHealthEntry[];
  duplicates: CatalogHealthEntry[];
}

export async function findCatalogHealthIssues(): Promise<CatalogHealthReport> {
  return tauriCmd<CatalogHealthReport>('find_catalog_health_issues', { orphans: [], duplicates: [] });
}

export async function searchCatalog(query: string): Promise<MediaCatalogEntry[]> {
  return tauriCmd<MediaCatalogEntry[]>('search_catalog', [], { query });
}

import type { SagaEntry } from '../anilist/saga';

export async function getCachedSaga(externalId: string): Promise<SagaEntry[] | null> {
  return tauriCmd<SagaEntry[] | null>('get_cached_saga', null, { externalId });
}

export async function saveCachedSaga(entries: SagaEntry[], sagaName = ''): Promise<void> {
  return tauriRun('save_cached_saga', { entries, sagaName });
}

export async function getSagaName(externalId: string): Promise<string> {
  return tauriCmd<string>('get_saga_name', '', { mediaExternalId: externalId });
}

// Bulk variant — used by the library grid's saga grouping to fetch every
// owned work's assigned saga name (if any) in one round trip.
export async function getSagaNames(mediaExternalIds: string[]): Promise<Record<string, string>> {
  return tauriCmd<Record<string, string>>('get_saga_names', {}, { mediaExternalIds });
}

export interface SagaMemberEntry {
  external_id: string;
  title: string;
  cover: string | null;
}

export interface SagaListEntry {
  id: string;
  name: string;
  anchor_title: string | null;
  anchor_cover: string | null;
  members: SagaMemberEntry[];
}

// Admin catalog editor's Sagas tab — id doubles as the anchor member's own
// external_id. Members are embedded (not a separate per-row fetch) since the
// list is a text list that expands in place to show them, no editor modal.
export async function getAllSagas(): Promise<SagaListEntry[]> {
  return tauriCmd<SagaListEntry[]>('get_all_sagas', []);
}

// GitHub's own sagas (community database.db), not the local install's.
export async function getCommunitySagas(): Promise<SagaListEntry[]> {
  return tauriCmd<SagaListEntry[]>('get_community_sagas', []);
}

export async function deleteSaga(sagaId: string): Promise<void> {
  return tauriRun('delete_saga', { sagaId });
}

export interface DbMediaRelation {
  /** Owning media for this relation — only meaningful inside a collaborative-
   *  catalog PR bundle (a saga PR can carry relations for more than one
   *  media); absent for plain save/getMediaRelations calls, which are
   *  already scoped to one media_external_id via their own parameter. */
  media_external_id?: string;
  related_media_external_id: string;
  relation_type: string;
  type_label: string;
  title: string;
  cover?: string | null;
  /** The related media's own format — only used to give the skeleton
   *  media_catalog row save_media_relations (Rust) creates for a not-yet-
   *  cataloged related title a real format, instead of leaving that column
   *  blank until (if ever) someone visits it directly. */
  format?: string | null;
}

export async function saveMediaRelations(mediaExternalId: string, relations: DbMediaRelation[]): Promise<void> {
  return tauriRun('save_media_relations', { mediaExternalId, relations });
}

export async function getMediaRelations(mediaExternalId: string): Promise<DbMediaRelation[]> {
  return tauriCmd<DbMediaRelation[]>('get_media_relations', [], { mediaExternalId });
}

// Same as getMediaRelations but never drops a relation just because the
// related entry is blocked_at — use this inside PrEditorModal (the
// collaborative-catalog editor), where a curator specifically needs to see
// and manage relations to/from blocked entries, not have them silently
// disappear the way they correctly do everywhere else on the site.
export async function getMediaRelationsForEditor(mediaExternalId: string): Promise<DbMediaRelation[]> {
  return tauriCmd<DbMediaRelation[]>('get_media_relations_for_editor', [], { mediaExternalId });
}

// Per-pair tombstones (deleted_relations) — related_media_external_ids the
// user has deliberately removed from mediaExternalId's relations, that a
// live/community relation merge must not silently re-add. Written
// automatically by save_media_relations whenever a previously-saved pair is
// missing from the new list it's given.
export async function getDeletedRelations(mediaExternalId: string): Promise<string[]> {
  return tauriCmd<string[]>('get_deleted_relations', [], { mediaExternalId });
}

// Bulk fetch across every media — used by the library grid's saga grouping,
// which needs the whole SEQUEL/PREQUEL graph up front instead of one
// getMediaRelations() round trip per library item.
export async function getAllMediaRelations(): Promise<DbMediaRelation[]> {
  return tauriCmd<DbMediaRelation[]>('get_all_media_relations', []);
}

export interface DbMediaAuthor {
  external_id: string;
  name: string;
  image?: string | null;
  role?: string | null;
  url?: string | null;
}

export async function saveMediaAuthors(mediaExternalId: string, authors: DbMediaAuthor[]): Promise<void> {
  return tauriRun('save_media_authors', { mediaExternalId, authors });
}

export async function getMediaAuthors(mediaExternalId: string): Promise<DbMediaAuthor[]> {
  return tauriCmd<DbMediaAuthor[]>('get_media_authors', [], { mediaExternalId });
}

// Downloads the repo's shared community catalog (built from merged
// collaborative-catalog PRs) and merges rows the user doesn't already have
// into their local media_catalog. Returns how many new rows were imported.
export async function syncCommunityCatalog(): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('sync_community_catalog');
}
