import { isTauri, invoke, tauriRun } from './core';

export async function scanAnimeFolder(folderPath: string): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>('scan_anime_folder', { folder_path: folderPath });
}

export async function playFileWithVlc(filePath: string): Promise<void> {
  return tauriRun('play_file_with_vlc', { file_path: filePath });
}

export interface AnimeLocalEntry {
  anilist_id: number;
  folder_path: string;
  episode_count: number;
  updated_at: string;
}

export async function saveAnimeFolder(anilistId: number, folderPath: string, episodeCount: number): Promise<void> {
  return tauriRun('save_anime_folder', { anilist_id: anilistId, folder_path: folderPath, episode_count: episodeCount });
}

export async function getAnimeFolder(anilistId: number): Promise<AnimeLocalEntry | null> {
  if (!isTauri()) return null;
  return invoke<AnimeLocalEntry | null>('get_anime_folder', { anilist_id: anilistId });
}
