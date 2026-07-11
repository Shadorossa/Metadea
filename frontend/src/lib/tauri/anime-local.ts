import { isTauri, invoke, tauriRun } from './core';

export async function scanAnimeFolder(folderPath: string): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>('scan_anime_folder', { folderPath });
}

export async function playFileWithVlc(filePath: string): Promise<void> {
  return tauriRun('play_file_with_vlc', { filePath });
}

export interface VlcPlaybackStatus {
  state:    string;
  position: number;
  time:     number;
  length:   number;
}

// Returns null whenever VLC's HTTP status interface isn't reachable (not
// running yet, or the user already had a VLC instance open without it) —
// callers should treat that as "no progress info available", not an error.
export async function getVlcPlaybackStatus(): Promise<VlcPlaybackStatus | null> {
  if (!isTauri()) return null;
  return invoke<VlcPlaybackStatus | null>('get_vlc_playback_status');
}

export interface AnimeLocalEntry {
  anilist_id: number;
  folder_path: string;
  episode_count: number;
  updated_at: string;
}

export async function saveAnimeFolder(anilistId: number, folderPath: string, episodeCount: number): Promise<void> {
  return tauriRun('save_anime_folder', { anilistId, folderPath, episodeCount });
}

export async function getAnimeFolder(anilistId: number): Promise<AnimeLocalEntry | null> {
  if (!isTauri()) return null;
  return invoke<AnimeLocalEntry | null>('get_anime_folder', { anilistId });
}
