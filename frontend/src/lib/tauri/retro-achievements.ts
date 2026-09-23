// IPC slice for src-tauri/src/retro_achievements: RA credentials live in
// app_env (see env.ts), progress is read through the Rust cache so the panel
// works offline, and each library entry maps to an RA game id through
// retro_achievements_links.
import { invoke, tauriCmd, tauriTry } from './bridge';

export interface RaCached<T> {
  data: T;
  fetchedAt: number;
  fromCache: boolean;
  // Served from the cache because the refresh failed (offline / API down).
  stale: boolean;
}

export interface RaStatus {
  configured: boolean;
  username: string | null;
  hashAvailable: boolean;
}

export type RaMatchedBy = 'hash' | 'name' | 'manual';

export interface RaLink {
  externalId: string;
  raGameId: number;
  matchedBy: RaMatchedBy;
  romHash: string | null;
  updatedAt: string;
}

export interface RaAchievement {
  id: number;
  title: string;
  description: string;
  points: number;
  trueRatio: number;
  badgeName: string;
  badgeUrl: string;
  badgeLockedUrl: string;
  displayOrder: number;
  kind: 'progression' | 'win_condition' | 'missable' | null;
  dateEarned: string | null;
  dateEarnedHardcore: string | null;
  unlocked: boolean;
  unlockedHardcore: boolean;
}

export type RaAwardKind = 'mastered' | 'completed' | 'beaten-hardcore' | 'beaten-softcore';

export interface RaGameProgress {
  gameId: number;
  title: string;
  consoleId: number;
  consoleName: string;
  iconUrl: string | null;
  total: number;
  unlocked: number;
  unlockedHardcore: number;
  pointsTotal: number;
  pointsUnlocked: number;
  completionPct: string | null;
  completionHardcorePct: string | null;
  highestAwardKind: RaAwardKind | null;
  highestAwardDate: string | null;
  achievements: RaAchievement[];
}

export interface RaProfileGame {
  gameId: number;
  title: string;
  iconUrl: string | null;
  consoleId: number;
  consoleName: string;
  total: number;
  unlocked: number;
  unlockedHardcore: number;
  mostRecentAwardedDate: string | null;
  highestAwardKind: RaAwardKind | null;
  highestAwardDate: string | null;
}

export interface RaProfileProgress {
  count: number;
  total: number;
  games: RaProfileGame[];
}

export interface RaRecentUnlock {
  date: string;
  hardcore: boolean;
  achievementId: number;
  title: string;
  description: string;
  badgeName: string;
  badgeUrl: string;
  points: number;
  gameId: number;
  gameTitle: string;
  consoleName: string;
}

export interface RaGameListEntry {
  id: number;
  title: string;
  consoleId: number;
  iconUrl: string | null;
  numAchievements: number;
  points: number;
  hashes: string[];
}

export interface RaConsole {
  id: number;
  name: string;
  active: boolean;
  isGameSystem: boolean;
}

export interface RaHashLookup {
  hash: string;
  gameId: number | null;
  source: 'game_list' | 'cache' | 'remote';
}

export async function raStatus(): Promise<RaStatus> {
  return tauriCmd<RaStatus>('ra_status', { configured: false, username: null, hashAvailable: false });
}

// RA console id for a platform, or null when RA has no set for it (3DS, Wii,
// Switch, PS3+...). Pass the IGDB platform id when known and/or the ROM
// scanner's `rom_platform` ("ds", "ps2", ...).
export async function raConsoleForPlatform(
  igdbPlatformId?: number | null,
  romPlatform?: string | null,
): Promise<number | null> {
  return tauriCmd<number | null>('ra_console_for_platform', null, {
    igdbPlatformId: igdbPlatformId ?? null,
    romPlatform: romPlatform ?? null,
  });
}

export async function raGetLink(externalId: string): Promise<RaLink | null> {
  return tauriTry<RaLink | null>('ra_get_link', null, { externalId });
}

export async function raSetLink(
  externalId: string,
  raGameId: number,
  matchedBy: RaMatchedBy,
  romHash?: string | null,
): Promise<RaLink> {
  return invoke<RaLink>('ra_set_link', { externalId, raGameId, matchedBy, romHash: romHash ?? null });
}

export async function raRemoveLink(externalId: string): Promise<void> {
  return invoke<void>('ra_remove_link', { externalId });
}

// Rejects with E_RA_HASH_UNAVAILABLE on builds without the rcheevos hasher.
export async function raLookupByHash(romPath: string, consoleId: number): Promise<RaHashLookup> {
  return invoke<RaHashLookup>('ra_lookup_by_hash', { romPath, consoleId });
}

export async function raMatchByName(title: string, consoleId: number): Promise<RaGameListEntry | null> {
  return invoke<RaGameListEntry | null>('ra_match_by_name', { title, consoleId });
}

export async function raSearchGames(consoleId: number, query: string): Promise<RaGameListEntry[]> {
  return invoke<RaGameListEntry[]>('ra_search_games', { consoleId, query });
}

export async function raGetGameProgress(raGameId: number, forceRefresh = false): Promise<RaCached<RaGameProgress>> {
  return invoke<RaCached<RaGameProgress>>('ra_get_game_progress', { raGameId, forceRefresh });
}

export async function raGetProfileProgress(forceRefresh = false): Promise<RaCached<RaProfileProgress>> {
  return invoke<RaCached<RaProfileProgress>>('ra_get_profile_progress', { forceRefresh });
}

export async function raGetRecentUnlocks(minutes = 60): Promise<RaRecentUnlock[]> {
  return invoke<RaRecentUnlock[]>('ra_get_recent_unlocks', { minutes });
}

export async function raGetConsoles(): Promise<RaCached<RaConsole[]>> {
  return invoke<RaCached<RaConsole[]>>('ra_get_consoles');
}
