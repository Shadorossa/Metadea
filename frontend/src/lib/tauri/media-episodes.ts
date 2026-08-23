import { tauriCmd, tauriRun } from './core';

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
