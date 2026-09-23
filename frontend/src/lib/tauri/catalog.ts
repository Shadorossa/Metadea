import { invoke, tauriCmd, tauriRun, isTauri } from './bridge';
import { getPreferredCover, getCoverPreference, readCoverPreferences } from '../media/cover-preferences';

export interface MediaCatalogEntry {
  id:                   string;
  external_id:          string;
  /** Curated ComicVine volume id used to resolve this work's issue list. */
  issue_source_id?:     string | null;
  /** Curated TMDB TV id used to resolve this work's episode list. */
  episode_source_id?:   string | null;
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
  favorites_count?:     number | null;
  format?:              string | null;
  genres_csv?:          string | null;
  genres_tag_csv?:      string | null;
  parent_id?:           string | null;
  platforms_csv?:       string | null;
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
  const entry = await tauriCmd<MediaCatalogEntry | null>('get_catalog_entry', null, { externalId });
  return entry ? { ...entry, cover_url: getPreferredCover(entry.external_id, entry.cover_url) } : null;
}

// Used to filter a live API fetch's raw relations/recommendations — the
// provider has no idea a related title was blocked (hidden) locally via the
// collaborative-catalog editor, so this must be checked client-side before
// ever showing such a title anywhere on the page.
export async function getBlockedExternalIds(): Promise<string[]> {
  return tauriCmd<string[]>('get_blocked_external_ids', []);
}

// Which of these game/vnovel search results already have their numeric id
// filed locally under the other type — no explicit block needed, the local
// reclassification is itself the signal (see get_reclassified_external_ids).
export async function getReclassifiedExternalIds(externalIds: string[]): Promise<string[]> {
  return tauriCmd<string[]>('get_reclassified_external_ids', [], { externalIds });
}

export async function deleteCatalogEntry(externalId: string): Promise<void> {
  return tauriRun('delete_catalog_entry', { externalId });
}

export async function updateCatalogGenres(externalId: string, genresCsv: string | null, genresTagCsv: string | null): Promise<void> {
  return tauriRun('update_catalog_genres', { externalId, genresCsv, genresTagCsv });
}

export async function updateCatalogTotalCount(externalId: string, totalCount: number): Promise<void> {
  return tauriRun('update_catalog_total_count', { externalId, totalCount });
}

// Same result as mapping getPreferredCover over every row, but the cover
// preferences blob is read/parsed once for the whole list and rows without
// a preference (the overwhelming majority) are returned as-is instead of
// being spread into a fresh object each — this runs over the full ~5k-row
// catalog on every profile/home/local load.
export function applyCoverPreferences<T extends { external_id: string; cover_url?: string | null }>(entries: T[]): T[] {
  const preferences = readCoverPreferences();
  return entries.map(entry => {
    const preferred = getCoverPreference(entry.external_id, preferences);
    if (preferred) return { ...entry, cover_url: preferred };
    // getPreferredCover normalizes a falsy cover_url to null; only pay for
    // the spread in that (rare) case.
    return entry.cover_url || entry.cover_url === null ? entry : { ...entry, cover_url: null };
  });
}

/** The narrow projection of a catalog row the profile/home grids actually
 *  read (LibraryCard, HofSection, CalendarSection, library-grouping,
 *  stats-calculators) — see CatalogSummary in media_catalog.rs. Structurally
 *  a subset of MediaCatalogEntry, so a `Map<string, CatalogSummary>` can be
 *  passed wherever only these fields are read. */
export interface CatalogSummary {
  id:             string;
  external_id:    string;
  type:           string;
  format:         string | null;
  status:         string | null;
  title_main:     string | null;
  title_english:  string | null;
  title_romaji:   string | null;
  title_native:   string | null;
  cover_url:      string | null;
  release_day:    number | null;
  release_month:  number | null;
  release_year:   number | null;
  total_count:    number | null;
  total_count_2:  number | null;
  time_length:    number | null;
  genres_csv:     string | null;
  parent_id:      string | null;
  updated_at:     string;
}

/** Either a full media_catalog row or its CatalogSummary projection — the
 *  parameter type for readers that only need the common columns and can
 *  treat every other one as optional (the library editor's placeholder
 *  render, Local's item shape). Both MediaCatalogEntry and CatalogSummary
 *  are assignable to it. */
export type CatalogEntryLike = Pick<MediaCatalogEntry, 'external_id' | 'type'> & Partial<MediaCatalogEntry>;

/** The CatalogSummary projection of a full row — for the one place a
 *  profile map built from summaries takes a freshly re-fetched full entry
 *  (LibrarySection's in-progress resync). */
export function toCatalogSummary(entry: MediaCatalogEntry): CatalogSummary {
  return {
    id:            entry.id,
    external_id:   entry.external_id,
    type:          entry.type,
    format:        entry.format ?? null,
    status:        entry.status ?? null,
    title_main:    entry.title_main ?? null,
    title_english: entry.title_english ?? null,
    title_romaji:  entry.title_romaji ?? null,
    title_native:  entry.title_native ?? null,
    cover_url:     entry.cover_url ?? null,
    release_day:   entry.release_day ?? null,
    release_month: entry.release_month ?? null,
    release_year:  entry.release_year ?? null,
    total_count:   entry.total_count ?? null,
    total_count_2: entry.total_count_2 ?? null,
    time_length:   entry.time_length ?? null,
    genres_csv:    entry.genres_csv ?? null,
    parent_id:     entry.parent_id ?? null,
    updated_at:    entry.updated_at,
  };
}

/** Scoped replacement for getAllCatalogEntries on the profile/home first
 *  paint: only the visible rows referenced by the user's own library
 *  (optionally one userId's rows), lists/favourites, monthly history and
 *  activity journey, in the CatalogSummary projection. Ids those views
 *  discover afterwards through relations (e.g. a bundle parent that isn't
 *  in the library) go through getCatalogEntriesByIds. */
export async function getCatalogEntriesForLibrary(userId?: string | null): Promise<CatalogSummary[]> {
  const entries = await tauriCmd<CatalogSummary[]>('get_catalog_entries_for_library', [], { userId: userId ?? null });
  return applyCoverPreferences(entries);
}

/** CatalogSummary rows for an explicit id list (chunked on the Rust side, so
 *  any length is fine). Unknown or blocked ids are simply absent. */
export async function getCatalogEntriesByIds(externalIds: string[]): Promise<CatalogSummary[]> {
  if (externalIds.length === 0) return [];
  const entries = await tauriCmd<CatalogSummary[]>('get_catalog_entries_by_ids', [], { externalIds });
  return applyCoverPreferences(entries);
}

export async function getAllCatalogEntries(): Promise<MediaCatalogEntry[]> {
  const entries = await tauriCmd<MediaCatalogEntry[]>('get_all_catalog_entries', []);
  return applyCoverPreferences(entries);
}

// Settings > Catalog is the only list where blocked works are visible, so
// they can be reopened in the collaborative editor and restored.
export async function getAllCatalogEntriesForEditor(): Promise<MediaCatalogEntry[]> {
  const entries = await tauriCmd<MediaCatalogEntry[]>('get_all_catalog_entries_for_editor', []);
  return applyCoverPreferences(entries);
}

// The regular lookup intentionally hides blocked catalog rows. Only the
// collaborative-catalog editor uses this exact-id read to inspect or restore
// the entry currently being edited.
export async function getCatalogEntryForEditor(externalId: string): Promise<MediaCatalogEntry | null> {
  const entry = await tauriCmd<MediaCatalogEntry | null>('get_catalog_entry_for_editor', null, { externalId });
  return entry ? { ...entry, cover_url: getPreferredCover(entry.external_id, entry.cover_url) } : null;
}

export async function searchCatalog(query: string): Promise<MediaCatalogEntry[]> {
  return tauriCmd<MediaCatalogEntry[]>('search_catalog', [], { query });
}

// Local disk cache (webp) for a catalog entry's cover_url — see
// get_cached_cover (Rust). Downloads+converts once per external_id, then
// every later call is just a file-exists check; the returned path still
// needs wrapAssetUrl() to become a loadable asset:// src. Throws if the
// download/conversion genuinely failed, so callers can fall back to the
// original remote URL instead.
export async function getCachedCover(externalId: string, url: string): Promise<string> {
  return invoke<string>('get_cached_cover', { externalId, url });
}

// One IPC call, existence-only, for a whole grid's worth of covers — call
// before mounting a batch of cards so already-cached ones can paint
// immediately instead of each card racing its own get_cached_cover call at
// mount. Misses (not in the returned map) still need an individual
// getCachedCover call to actually download.
export async function getCachedCoversBatch(externalIds: string[]): Promise<Record<string, string>> {
  if (externalIds.length === 0) return {};
  return invoke<Record<string, string>>('get_cached_covers_batch', { externalIds });
}

import type { SagaEntry } from '../anilist/saga';

export async function getCachedSaga(externalId: string): Promise<SagaEntry[] | null> {
  return tauriCmd<SagaEntry[] | null>('get_cached_saga', null, { externalId });
}

export async function saveCachedSaga(entries: SagaEntry[], sagaName = ''): Promise<void> {
  return tauriRun('save_cached_saga', { entries, sagaName });
}

export async function removeSagaMember(mediaExternalId: string): Promise<void> {
  return tauriRun('remove_saga_member', { mediaExternalId });
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
  /** Release date of the related media — used for sorting relations by
   *  release date within each relation type category. */
  release_day?: number | null;
  release_month?: number | null;
  release_year?: number | null;
}

// Fired after any relations write below so the Profile/Home shared cache of
// scoped relations (lib/profile/library-data-cache.ts) drops its copy
// — same idea as library.ts's notifyLibraryChanged, but deliberately a
// separate event: 'refresh-profile-library' also makes every mounted
// profile tab re-fetch and re-render, which a relation edit on a media page
// has no business triggering.
function notifyMediaRelationsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('media-relations-changed'));
}

export async function saveMediaRelations(mediaExternalId: string, relations: DbMediaRelation[]): Promise<void> {
  await tauriRun('save_media_relations', { mediaExternalId, relations });
  notifyMediaRelationsChanged();
}

export async function replaceIssueRelations(mediaExternalId: string, relations: DbMediaRelation[]): Promise<void> {
  await tauriRun('replace_issue_relations', { mediaExternalId, relations });
  notifyMediaRelationsChanged();
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

// Semantic BASE_EDITION parents for Local's blocked-edition fallback,
// including older reverse-stored edition links (base -> remaster).
export async function getBaseEditionCandidatesForRedirect(mediaExternalId: string): Promise<string[]> {
  return tauriCmd<string[]>('get_base_edition_candidates_for_redirect', [], { mediaExternalId });
}

// Per-pair tombstones (deleted_relations) - related_media_external_ids the
// user has deliberately removed from mediaExternalId's relations, that a
// live/community relation merge must not silently re-add. Written
// automatically by save_media_relations whenever a previously-saved pair is
// missing from the new list it's given.
export async function getDeletedRelations(mediaExternalId: string): Promise<string[]> {
  return tauriCmd<string[]>('get_deleted_relations', [], { mediaExternalId });
}

/** Scoped replacement for the old catalog-wide get_all_media_relations:
 *  only relations where the owner OR the related side is one of externalIds
 *  (typically the library's own ids), same row shape and curated order.
 *  excludeTypes drops relation kinds the caller never groups by — pass
 *  ['RECOMMENDATION'] for the profile's saga/bundle grouping, which is by
 *  far the largest fan-out. Callers that need the whole franchise graph
 *  around those ids (not just their direct edges) go through
 *  lib/profile/relations-scope.ts's loadScopedMediaRelations. */
export async function getMediaRelationsForIds(externalIds: string[], excludeTypes?: string[]): Promise<DbMediaRelation[]> {
  if (externalIds.length === 0) return [];
  return tauriCmd<DbMediaRelation[]>('get_media_relations_for_ids', [], { externalIds, excludeTypes: excludeTypes ?? null });
}

// Purely local negative cache (anilist_pre_sequel table) — see
// seasonResolve.ts's fetchAniListRelationEdges. Records that this install
// already asked AniList for mediaExternalId's prequel/sequel and found
// nothing new, so a standalone/season-1 title's Local panel doesn't re-ask
// AniList the same question every time it's opened.
export async function getAnilistPreSequelChecked(mediaExternalId: string): Promise<boolean> {
  return tauriCmd<boolean>('get_anilist_pre_sequel_checked', false, { externalId: mediaExternalId });
}

export async function markAnilistPreSequelChecked(mediaExternalId: string): Promise<void> {
  return tauriRun('mark_anilist_pre_sequel_checked', { externalId: mediaExternalId });
}

export interface DbMediaAuthor {
  external_id: string;
  name: string;
  image?: string | null;
  role?: string | null;
  url?: string | null;
  // Full-profile fields — only ever populated via saveAuthorProfileAndRelations
  // (the author's own page), never by saveMediaAuthors (a media page's
  // lightweight author list, which never touches these — see media_authors.rs).
  name_native?: string | null;
  aliases_csv?: string | null;
  biography?: string | null;
  birth_date?: string | null;
  death_date?: string | null;
}

export async function saveMediaAuthors(mediaExternalId: string, authors: DbMediaAuthor[]): Promise<void> {
  return tauriRun('save_media_authors', { mediaExternalId, authors });
}

export async function getMediaAuthors(mediaExternalId: string): Promise<DbMediaAuthor[]> {
  return tauriCmd<DbMediaAuthor[]>('get_media_authors', [], { mediaExternalId });
}

export async function getAuthor(externalId: string): Promise<DbMediaAuthor | null> {
  return tauriCmd<DbMediaAuthor | null>('get_author', null, { externalId });
}

export interface AuthorWork {
  media_external_id: string;
  role?: string | null;
  title: string;
  cover?: string | null;
}

export async function getAuthorWorks(authorExternalId: string): Promise<AuthorWork[]> {
  return tauriCmd<AuthorWork[]>('get_author_works', [], { authorExternalId });
}

export interface AuthorWorkRelation {
  media_external_id: string;
  role?: string | null;
  title: string;
  cover?: string | null;
}

export async function saveAuthorProfileAndRelations(author: DbMediaAuthor, relations: AuthorWorkRelation[]): Promise<void> {
  return tauriRun('save_author_profile_and_relations', { author, relations });
}

// Downloads the repo's shared community catalog (built from merged
// collaborative-catalog PRs) and merges rows the user doesn't already have
// into their local media_catalog. Returns how many new rows were imported.
export async function syncCommunityCatalog(): Promise<number> {
  if (!isTauri()) return 0;
  const imported = await invoke<number>('sync_community_catalog');
  notifyMediaRelationsChanged();
  return imported;
}
