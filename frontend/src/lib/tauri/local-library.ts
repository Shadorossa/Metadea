import { isTauri, invoke, tauriCmd, tauriRun } from './core';
import { STORAGE_KEYS } from '../shared/storage-keys';

export interface LocalGame {
  name:              string;
  launcher:          'steam' | 'epic' | 'xbox' | 'gog' | 'ea' | 'local';
  app_id?:           string;
  external_id?:      string;
  install_path?:     string;
  playtime_minutes?: number;
  last_played?:      number;
  installed?:        boolean;
}

export interface SteamOwnedGame {
  appid:              number;
  name:               string;
  playtime_forever:   number;
  rtime_last_played?: number;
  img_icon_url?:      string;
}

export interface LocalFolderEntry {
  name:         string;
  is_dir:       boolean;
  size:         number;
  child_count?: number;
}

export interface SavedFolder {
  path:  string;
  label: string;
}

export async function pickFolder(): Promise<string | null> {
  return tauriCmd<string | null>('pick_folder', null);
}

export async function scanFolderContents(path: string): Promise<LocalFolderEntry[]> {
  return tauriCmd<LocalFolderEntry[]>('scan_folder_contents', [], { path });
}

export async function openLocalFile(path: string): Promise<void> {
  return tauriRun('open_local_file', { path });
}

export async function scanAllGames(): Promise<LocalGame[]> {
  return tauriCmd<LocalGame[]>('scan_all_games', []);
}

// Durable, manual (launcher, linkKey) -> catalog external_id override —
// read by scan_all_games (see lookup_game_links in folders.rs) before any
// automatic Steam-ID/fuzzy-name matching runs, so a manual pick here always
// wins on every future scan instead of only patching the cached cover once.
// linkKey must match scan_all_games' own key derivation exactly:
// app_id ?? install_path ?? name.
export async function saveGameLink(launcher: string, linkKey: string, externalId: string): Promise<void> {
  return tauriRun('save_game_link', { launcher, linkKey, externalId });
}

export async function deleteGameLink(launcher: string, linkKey: string): Promise<void> {
  return tauriRun('delete_game_link', { launcher, linkKey });
}

export async function getLocalFolders(): Promise<SavedFolder[]> {
  if (!isTauri()) {
    const stored = localStorage.getItem(STORAGE_KEYS.localFolders);
    return stored ? JSON.parse(stored) : [];
  }
  return invoke<SavedFolder[]>('get_local_folders');
}

export async function saveLocalFolders(folders: SavedFolder[]): Promise<void> {
  if (!isTauri()) { localStorage.setItem(STORAGE_KEYS.localFolders, JSON.stringify(folders)); return; }
  return invoke<void>('save_local_folders', { foldersJson: JSON.stringify(folders) });
}
