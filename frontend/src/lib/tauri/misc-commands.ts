// Grouped small single-purpose command wrappers that used to each get their
// own file (companies.ts, discord.ts, media-episodes.ts, routes.ts,
// staff.ts) — every one of them was under 30 lines, just a couple of thin
// invoke() wrappers plus a type. lib/tauri/'s usual one-file-per-domain
// split (see index.ts) still makes sense for the larger modules; for this
// handful of tiny leaf domains it was adding more navigation overhead than
// payoff, so they're combined here instead.
import { tauriCmd, tauriRun, readStoredJson, writeStoredJson } from './core';
import { STORAGE_KEYS } from '../shared/storage-keys';

// ── Companies (developer/publisher) ─────────────────────────────────────────

export interface DbMediaCompany {
  external_id: string;
  name: string;
  logo_url?: string | null;
  /** 'developer' | 'publisher' — see MediaCompany's own doc comment (lib/media/types.ts) for the full per-provider mapping. */
  role: string;
}

// Get all companies (developer/publisher) cached locally for a specific media
export async function getMediaCompanies(mediaExternalId: string): Promise<DbMediaCompany[]> {
  return tauriCmd<DbMediaCompany[]>('get_media_companies', [], { mediaExternalId });
}

export async function saveMediaCompanies(mediaExternalId: string, companies: DbMediaCompany[]): Promise<void> {
  return tauriRun('save_media_companies', { mediaExternalId, companies });
}

// ── Category routes (Local's folder-per-category mapping) ──────────────────

export async function readRoutes(): Promise<Record<string, string>> {
  return readStoredJson<Record<string, string>>('read_routes', STORAGE_KEYS.categoryRoutes, {});
}

export async function writeRoutes(routes: Record<string, string>): Promise<void> {
  return writeStoredJson('write_routes', STORAGE_KEYS.categoryRoutes, routes, 'routesJson');
}

// ── Discord Rich Presence ────────────────────────────────────────────────────

// Update Discord Rich Presence details and status state
export async function updateDiscordPresence(
  details: string,
  state: string,
  startTime?: number,
  endTime?: number,
  largeImage?: string,
  largeText?: string,
  smallImage?: string,
  smallText?: string
): Promise<void> {
  return tauriRun('update_presence', {
    details,
    state,
    startTime,
    endTime,
    largeImage,
    largeText,
    smallImage,
    smallText,
  });
}

// Reset Discord Rich Presence to default browsing state
export async function resetDiscordPresence(): Promise<void> {
  return tauriRun('reset_presence');
}

// ── Per-episode metadata (media page's "Episodios" tab) ─────────────────────

export interface MediaEpisode {
  external_id:    string;
  season_number:  number;
  episode_number: number;
  name:           string | null;
  cover_url:      string | null;
}

export async function getMediaEpisodes(externalId: string): Promise<MediaEpisode[]> {
  return tauriCmd<MediaEpisode[]>('get_media_episodes', [], { externalId });
}

// Always the whole list for externalId, never a partial update — see the
// Rust command's own comment for why.
export async function saveMediaEpisodes(externalId: string, episodes: MediaEpisode[]): Promise<void> {
  return tauriRun('save_media_episodes', { externalId, episodes });
}

// ── Staff (crew) ─────────────────────────────────────────────────────────────

export interface DbMediaStaffMember {
  external_id: string;
  name: string;
  image_url?: string | null;
  role?: string | null;
}

// Get all staff cached locally for a specific media
export async function getMediaStaff(mediaExternalId: string): Promise<DbMediaStaffMember[]> {
  return tauriCmd<DbMediaStaffMember[]>('get_media_staff', [], { mediaExternalId });
}

export interface SkeletonStaffMember {
  external_id: string;
  name: string;
  image_url?: string | null;
  role?: string | null;
}

export async function saveStaffSkeleton(mediaExternalId: string, staff: SkeletonStaffMember[]): Promise<void> {
  return tauriRun('save_staff_skeleton', { mediaExternalId, staff });
}
