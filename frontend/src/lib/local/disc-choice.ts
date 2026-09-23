// Multi-disc games (LocalGame.discs): which disc boots. The choice made in
// the game panel's disc selector is remembered per game (app_id) on this
// device, so Play — from the panel or Big Picture — boots the same disc
// next time. Storage failures fall back to the first disc; none of this is
// user data. Which file actually runs (the .m3u or the disc) is decided in
// Rust (folders/disc_launch.rs).
import type { LocalGame } from '../tauri/local-library';
import { STORAGE_KEYS } from '../storage/storage-keys';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LaunchDiscChoice {
  discPath: string | null;
  discPlaylist: string | null;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readChoices(storage: StorageLike | null): Record<string, string> {
  try {
    const raw = storage?.getItem(STORAGE_KEYS.romDiscChoice);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function isMultiDisc(game: Pick<LocalGame, 'discs'>): boolean {
  return (game.discs?.length ?? 0) > 1;
}

/** The disc last picked for `game`, when it is still one of its discs; else the first. */
export function rememberedDisc(game: Pick<LocalGame, 'app_id' | 'discs'>, storage: StorageLike | null = defaultStorage()): string | null {
  const discs = game.discs ?? [];
  if (discs.length === 0) return null;
  const saved = game.app_id ? readChoices(storage)[game.app_id] : undefined;
  return saved && discs.includes(saved) ? saved : discs[0];
}

export function rememberDisc(appId: string | undefined, discPath: string, storage: StorageLike | null = defaultStorage()): void {
  if (!appId) return;
  try {
    const choices = readChoices(storage);
    choices[appId] = discPath;
    storage?.setItem(STORAGE_KEYS.romDiscChoice, JSON.stringify(choices));
  } catch {}
}

/** What launch_game gets for a multi-disc game (null for anything else). */
export function launchDiscChoice(
  game: Pick<LocalGame, 'app_id' | 'discs' | 'disc_playlist'>,
  picked?: string | null,
  storage: StorageLike | null = defaultStorage(),
): LaunchDiscChoice | null {
  if (!isMultiDisc(game)) return null;
  const discs = game.discs ?? [];
  const discPath = picked && discs.includes(picked) ? picked : rememberedDisc(game, storage);
  return { discPath, discPlaylist: game.disc_playlist ?? null };
}
