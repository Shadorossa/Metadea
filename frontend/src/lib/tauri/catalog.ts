import { isTauri, invoke, tauriCmd, tauriRun } from './core';

export interface MediaCatalogEntry {
  id:                   string;
  external_id:          string;
  parent_id?:           string | null;
  type:                 string;
  format?:              string | null;
  source?:              string | null;
  title_main?:          string | null;
  title_romaji?:        string | null;
  title_native?:        string | null;
  synopsis?:            string | null;
  cover_url?:           string | null;
  banners_csv?:         string | null;
  release_year?:        number | null;
  release_month?:       number | null;
  release_day?:         number | null;
  time_length?:         number | null;
  status?:              string | null;
  score_global?:        number | null;
  favorites_count?:     number | null;
  ratings_count?:       number | null;
  total_count?:         number | null;
  total_count_2?:       number | null;
  genres_csv?:          string | null;
  genres_tag_csv?:      string | null;
  platforms_csv?:       string | null;
  /** CSV of "platform|url" pairs — IGDB's store links (Steam, GOG, ...) for this game. */
  shop_links_csv?:      string | null;
  companies_cache_csv?: string | null;
  authors_csv?:         string | null;
  last_synced_at?:      string | null;
  sync_failed_count?:   number | null;
  last_sync_error?:     string | null;
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

export async function deleteCatalogEntry(externalId: string): Promise<void> {
  return tauriRun('delete_catalog_entry', { externalId });
}

export async function getAllCatalogEntries(): Promise<MediaCatalogEntry[]> {
  return tauriCmd<MediaCatalogEntry[]>('get_all_catalog_entries', []);
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
  return tauriCmd<string>('get_saga_name', '', { externalId });
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
}

export async function saveMediaRelations(mediaExternalId: string, relations: DbMediaRelation[]): Promise<void> {
  return tauriRun('save_media_relations', { mediaExternalId, relations });
}

export async function getMediaRelations(mediaExternalId: string): Promise<DbMediaRelation[]> {
  return tauriCmd<DbMediaRelation[]>('get_media_relations', [], { mediaExternalId });
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
