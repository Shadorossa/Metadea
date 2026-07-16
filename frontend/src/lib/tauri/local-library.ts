import { tauriCmd, tauriRun } from './core';

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

export async function pickFolder(): Promise<string | null> {
  return tauriCmd<string | null>('pick_folder', null);
}

export async function scanFolderContents(path: string): Promise<LocalFolderEntry[]> {
  return tauriCmd<LocalFolderEntry[]>('scan_folder_contents', [], { path });
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

