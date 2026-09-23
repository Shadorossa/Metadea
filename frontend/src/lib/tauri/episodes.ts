import { tauriCmd, tauriRun } from './bridge';
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
