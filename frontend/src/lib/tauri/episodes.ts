import { tauriCmd, tauriRun } from './bridge';
import { notifyMediaPartChanged } from './change-events';
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
  await tauriRun('save_media_episodes', { externalId, episodes });
  notifyMediaPartChanged('episodes');
}

export async function deleteAllMediaEpisodes(externalId: string): Promise<void> {
  await tauriRun('delete_all_media_episodes', { externalId });
  notifyMediaPartChanged('episodes');
}
