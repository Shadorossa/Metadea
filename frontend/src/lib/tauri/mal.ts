// IPC layer for MyAnimeList (src-tauri/src/mal): login through the
// `metadea://auth/mal` deep link, list-status writes and the user's list
// for the import. Every call needs Tauri; the sync/import modules in
// lib/mal decide what to do when it is unavailable.
import { invoke, tauriCmd } from './bridge';

/** The exact text the owner registers as "App Redirect URL" on
 *  myanimelist.net/apiconfig — mirrors oauth::REDIRECT_URI. */
export const MAL_REDIRECT_URI = 'metadea://auth/mal';
/** Emitted by Rust when a login finishes: `{ ok, error }`. */
export const MAL_AUTH_RESULT_EVENT = 'mal://auth-result';

export type MalListKind = 'anime' | 'manga';

export interface MalStatus {
  client_id_configured: boolean;
  connected: boolean;
  redirect_uri: string;
}

export interface MalProfile {
  id: number;
  name: string;
  picture: string | null;
}

export interface MalAuthResult {
  ok: boolean;
  error: string | null;
}

// MAL's own vocabulary (api::AnimeListUpdate / MangaListUpdate). Dates are
// YYYY-MM-DD; a field left undefined is not sent.
export interface MalAnimeListUpdate {
  status?: MalAnimeStatus;
  score?: number;
  num_watched_episodes?: number;
  start_date?: string;
  finish_date?: string;
  is_rewatching?: boolean;
  num_times_rewatched?: number;
}

export interface MalMangaListUpdate {
  status?: MalMangaStatus;
  score?: number;
  num_chapters_read?: number;
  num_volumes_read?: number;
  start_date?: string;
  finish_date?: string;
  is_rereading?: boolean;
  num_times_reread?: number;
}

export type MalAnimeStatus = 'watching' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_watch';
export type MalMangaStatus = 'reading' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_read';

/** One row of the user's list (api::ListItem): `progress` is episodes for
 *  anime and chapters for manga; `progress_volumes` only for manga. */
export interface MalListItem {
  mal_id: number;
  title: string;
  status: string;
  score: number;
  progress: number;
  progress_volumes: number;
  is_repeating: boolean;
  start_date: string | null;
  finish_date: string | null;
  updated_at: string | null;
}

export interface MalCatalogLink {
  mal_id: number;
  external_id: string;
  type: string;
}

export async function malStatus(): Promise<MalStatus> {
  return invoke<MalStatus>('mal_status');
}

/** Returns the authorization URL to open in the system browser. */
export async function malBeginLogin(): Promise<string> {
  return invoke<string>('mal_begin_login');
}

export async function malCompleteLogin(code: string, state: string): Promise<void> {
  await invoke<void>('mal_complete_login', { code, state });
}

export async function malGetProfile(): Promise<MalProfile> {
  return invoke<MalProfile>('mal_get_profile');
}

export async function malLogout(): Promise<void> {
  await invoke<void>('mal_logout');
}

export async function malUpdateAnime(malId: number, update: MalAnimeListUpdate): Promise<void> {
  await invoke<void>('mal_update_anime', { malId, update });
}

export async function malUpdateManga(malId: number, update: MalMangaListUpdate): Promise<void> {
  await invoke<void>('mal_update_manga', { malId, update });
}

export async function malDeleteEntry(kind: MalListKind, malId: number): Promise<void> {
  await invoke<void>('mal_delete_entry', { kind, malId });
}

export async function malFetchList(kind: MalListKind): Promise<MalListItem[]> {
  return invoke<MalListItem[]>('mal_fetch_list', { kind });
}

/** Catalog rows already carrying one of these MAL ids, scoped to the kind
 *  (MAL's anime and manga id spaces overlap). Read: empty on failure. */
export async function malCatalogLinksByMalIds(kind: MalListKind, malIds: number[]): Promise<MalCatalogLink[]> {
  if (malIds.length === 0) return [];
  return tauriCmd<MalCatalogLink[]>('mal_catalog_links_by_mal_ids', [], { kind, malIds });
}

/** Batched `set_catalog_mal_id`; returns how many rows changed. */
export async function malRememberCatalogLinks(links: MalCatalogLink[]): Promise<number> {
  if (links.length === 0) return 0;
  return invoke<number>('mal_remember_catalog_links', { links });
}
