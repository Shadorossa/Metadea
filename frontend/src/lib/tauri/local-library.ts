import { STORAGE_KEYS } from '../storage/storage-keys';
import { tauriCmd, tauriRun, readStoredJson, writeStoredJson } from './bridge';

export interface LocalGame {
  name:              string;
  launcher:          'steam' | 'epic' | 'xbox' | 'gog' | 'ea' | 'nintendo' | 'playstation' | 'local';
  app_id?:           string;
  external_id?:      string;
  install_path?:     string;
  playtime_minutes?: number;
  last_played?:      number;
  installed?:        boolean;
  // The specific emulator_configs platform_id (e.g. "3ds", "ps4") this ROM
  // was scanned under, when this entry came from scan_emulator_roms instead
  // of an actual Steam/Epic/... install — `launcher` above only ever holds
  // the company-level grouping ("nintendo"/"playstation"/"xbox"), so this is
  // what launchGame needs to find the right EmulatorConfig to run it with.
  rom_platform?:     string;
  // Multi-disc sets (platform_scanning/multi_disc.rs): every disc in boot
  // order (install_path is the first) and the set's .m3u, when it has one.
  discs?:            string[];
  disc_playlist?:    string | null;
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

export async function pickFile(): Promise<string | null> {
  return tauriCmd<string | null>('pick_file', null);
}

export async function scanFolderContents(path: string): Promise<LocalFolderEntry[]> {
  return tauriCmd<LocalFolderEntry[]>('scan_folder_contents', [], { path });
}

// Used by the "Localizar" flow (LocalMediaDetailPanel) — renames a single
// file or folder. Refuses to overwrite an existing path at the destination
// (see rename_path's own Rust-side comment).
export async function renamePath(oldPath: string, newPath: string): Promise<void> {
  return tauriRun('rename_path', { oldPath, newPath });
}

// `force` drops the Rust-side per-launcher memo first (see scan_cache.rs) —
// the "Escanear de nuevo" button; a plain Local visit lets every launcher
// whose registry/manifests/folders haven't changed answer from the memo.
export async function scanAllGames(force = false): Promise<LocalGame[]> {
  return tauriCmd<LocalGame[]>('scan_all_games', [], { force });
}

export interface TaggedPathMatch {
  abs_path: string;
  is_dir: boolean;
}

// folder-match.ts's findTaggedPathRecursive walk, done in one round trip on
// the Rust side (see find_tagged_path): the first "[tag]"-named entry under
// basePath, depth-first in listing order, at most maxDepth levels down.
export async function findTaggedPath(basePath: string, tag: string, maxDepth = 3): Promise<TaggedPathMatch | null> {
  return tauriCmd<TaggedPathMatch | null>('find_tagged_path', null, { basePath, tag, maxDepth });
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

// Manually drops a scanned/ghost game off the grid for good — see
// remove_local_game's own doc comment (game_links.rs) for why this can't
// un-scan a genuinely-installed game (it just reappears on the next scan),
// only ghosts/stale-restored entries and bad matches.
export async function removeLocalGame(launcher: string, linkKey: string): Promise<void> {
  return tauriRun('remove_local_game', { launcher, linkKey });
}

export interface HiddenGameKey {
  launcher:  string;
  link_key:  string;
}

// scan_all_games already filters its own output against this (see
// remove_local_game's doc comment) — this is only needed by anything that
// merges MORE games in client-side, after that filtering has already run
// (see steam-merge.ts's owned-but-uninstalled Steam games), so a removal
// made there doesn't silently come back on the next scan.
export async function getHiddenLocalGames(): Promise<HiddenGameKey[]> {
  return tauriCmd<HiddenGameKey[]>('get_hidden_local_games', []);
}

// ── Category routes (Local's folder-per-category mapping) ──────────────────

export async function readRoutes(): Promise<Record<string, string>> {
  return readStoredJson<Record<string, string>>('read_routes', STORAGE_KEYS.categoryRoutes, {});
}

export async function writeRoutes(routes: Record<string, string>): Promise<void> {
  return writeStoredJson('write_routes', STORAGE_KEYS.categoryRoutes, routes, 'routesJson');
}
