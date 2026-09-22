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
  /** Provider-specific identity, e.g. TMDB series/season/episode. */
  source_key?:     string | null;
  /** Chain signature used to invalidate cache when its season mapping changes. */
  mapping_key?:    string | null;
  /** Display-only label used by synthetic unified-chain entries (e.g. M01). */
  display_label?: string;
}

export interface MediaEpisodeGroup {
  external_id:   string;
  episode_count: number;
  sample_name:   string | null;
  sample_cover:  string | null;
}

export async function getMediaEpisodes(externalId: string): Promise<MediaEpisode[]> {
  return tauriCmd<MediaEpisode[]>('get_media_episodes', [], { externalId });
}

export async function getAllMediaEpisodesGrouped(): Promise<MediaEpisodeGroup[]> {
  return tauriCmd<MediaEpisodeGroup[]>('get_all_media_episodes_grouped', []);
}

export async function saveMediaEpisodes(externalId: string, episodes: MediaEpisode[]): Promise<void> {
  return tauriRun('save_media_episodes', { externalId, episodes });
}

export async function deleteAllMediaEpisodes(externalId: string): Promise<void> {
  return tauriRun('delete_all_media_episodes', { externalId });
}

// API-Sports competition structure and match results are persisted separately
// from media_catalog, so event pages keep their season/match tabs offline.
export interface ApiSportsEventSeasonRow {
  externalId: string;
  competitionExternalId: string;
  seasonKey: string;
  seasonNumber: number;
  name: string;
  coverUrl: string | null;
  airDate: string | null;
  isCurrent: boolean;
  matchesSyncedAt: string | null;
}

export interface ApiSportsEventMatchRow {
  id: string;
  date: string | null;
  time: string | null;
  home: string | null;
  away: string | null;
  homeScore: string | null;
  awayScore: string | null;
  image: string | null;
  venue: string | null;
  status: string | null;
}

export interface ApiSportsEventMatchCache {
  syncedAt: string | null;
  matches: ApiSportsEventMatchRow[];
}

export async function getApiSportsEventSeasons(competitionExternalId: string): Promise<ApiSportsEventSeasonRow[]> {
  return tauriCmd<ApiSportsEventSeasonRow[]>('get_api_sports_event_seasons', [], { competitionExternalId });
}

export async function saveApiSportsEventSeasons(seasons: ApiSportsEventSeasonRow[]): Promise<void> {
  return tauriRun('save_api_sports_event_seasons', { seasons });
}

export async function getApiSportsEventMatches(seasonExternalId: string): Promise<ApiSportsEventMatchCache> {
  return tauriCmd<ApiSportsEventMatchCache>('get_api_sports_event_matches', { syncedAt: null, matches: [] }, { seasonExternalId });
}

export async function saveApiSportsEventMatches(seasonExternalId: string, matches: ApiSportsEventMatchRow[]): Promise<void> {
  return tauriRun('save_api_sports_event_matches', { seasonExternalId, matches });
}

// ── Anime openings/endings, animethemes.moe (media page's "Temas" tab) ──────

export interface MediaTheme {
  external_id: string;
  slug:        string;
  theme_type:  'OP' | 'ED';
  sequence:    number;
  song_title:  string | null;
  artists:     string | null;
  episodes:    string | null;
  video_url:   string | null;
  preview_url?: string | null;
  versions?:   string | null;
}

export async function getMediaThemes(externalId: string): Promise<MediaTheme[]> {
  return tauriCmd<MediaTheme[]>('get_media_themes', [], { externalId });
}

export async function saveMediaThemes(externalId: string, themes: MediaTheme[]): Promise<void> {
  return tauriRun('save_media_themes', { externalId, themes });
}

export async function saveThemePreviewFrame(externalId: string, slug: string, dataBase64: string): Promise<string> {
  return tauriCmd<string>('save_theme_preview_frame', '', { externalId, slug, dataBase64 });
}

export async function getThemePreviewFrame(externalId: string, slug: string): Promise<string | null> {
  return tauriCmd<string | null>('get_theme_preview_frame', null, { externalId, slug });
}

export async function cacheThemeVideo(url: string, externalId: string, slug: string): Promise<string> {
  return tauriCmd<string>('cache_theme_video', '', { url, externalId, slug });
}

export async function getThemeVideoPath(externalId: string, slug: string): Promise<string | null> {
  return tauriCmd<string | null>('get_cached_theme_video', null, { externalId, slug });
}

export async function deleteCachedThemeVideo(externalId: string, slug: string): Promise<void> {
  return tauriRun('delete_cached_theme_video', { externalId, slug });
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
