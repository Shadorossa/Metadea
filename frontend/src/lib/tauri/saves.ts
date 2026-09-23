// Emulator save manager (src-tauri/src/saves): one central folder for every
// battery save and save state, labels, a short version history per save and
// an optional Google Drive copy. See docs/SAVES.md.
import { invoke } from './bridge';

export type SaveKind = 'battery' | 'state';
/** How the configured emulator's saves reach the central folder. */
export type SaveStrategy = 'redirect' | 'mirror' | 'unsupported';

/** A game as the Rust side identifies it (platform + ROM path, title for new folders). */
export interface SaveGameRef {
  platformId: string;
  romPath: string;
  title?: string | null;
}

export interface SaveVersion {
  /** Stamped history folder name, passed back to restoreSaveVersion. */
  id: string;
  modifiedMs: number;
  size: number;
}

export interface SaveEntry {
  /** `battery/…`, `states/…`, or `@shared/battery/…` for a platform's shared memory card. */
  id: string;
  kind: SaveKind;
  name: string;
  slot: string | null;
  size: number;
  modifiedMs: number;
  label: string | null;
  /** `data:` URL of the state's screenshot, when the emulator wrote one. */
  thumbnail: string | null;
  isFolder: boolean;
  shared: boolean;
  versions: SaveVersion[];
  /** Every file of it matches what was last synced with Google Drive. */
  synced: boolean;
}

export interface GameSaves {
  strategy: SaveStrategy;
  emulator: string | null;
  root: string;
  folder: string | null;
  driveSync: boolean;
  entries: SaveEntry[];
}

export interface SavesStatus {
  root: string;
  defaultRoot: string;
  customRoot: boolean;
  driveSync: boolean;
  historyKeep: number;
  /** Full backups (local and Drive) carry the saves folder. */
  includeInBackup: boolean;
  driveLinked: boolean;
  lastSyncAt: string | null;
  /** `E_*` code (with detail) of the last failed sync. */
  lastSyncError: string | null;
}

export interface SavesSettings {
  /** null = the default folder (Documents\Metadea\Saves). */
  root: string | null;
  driveSync: boolean;
  historyKeep: number;
  includeInBackup: boolean;
}

/** What "Include game saves" adds to a backup: saves count and total bytes. */
export interface SavesBackupEstimate {
  files: number;
  bytes: number;
}

export interface SavesImportSummary {
  games: number;
  captured: number;
  skipped: number;
}

export interface SavesSyncReport {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  failed: number;
}

export const SAVES_CHANGED_EVENT = 'saves://changed';

export function getSavesSettings(): Promise<SavesStatus> {
  return invoke<SavesStatus>('saves_get_settings');
}

export function setSavesSettings(settings: SavesSettings): Promise<SavesStatus> {
  return invoke<SavesStatus>('saves_set_settings', { settings });
}

export function getSavesBackupEstimate(): Promise<SavesBackupEstimate> {
  return invoke<SavesBackupEstimate>('saves_backup_estimate');
}

export function listGameSaves(game: SaveGameRef): Promise<GameSaves> {
  return invoke<GameSaves>('saves_list_game', { game });
}

/** A blank label clears it. */
export function setSaveLabel(game: SaveGameRef, id: string, label: string | null): Promise<GameSaves> {
  return invoke<GameSaves>('saves_set_label', { game, id, label });
}

export function restoreSaveVersion(game: SaveGameRef, id: string, version: string): Promise<GameSaves> {
  return invoke<GameSaves>('saves_restore_version', { game, id, version });
}

/** Moves the save into the game's `.archive` folder (never deleted). */
export function archiveSave(game: SaveGameRef, id: string): Promise<GameSaves> {
  return invoke<GameSaves>('saves_archive', { game, id });
}

/** The game's folder, or the saves root when `game` is omitted. */
export function openSavesFolder(game?: SaveGameRef | null): Promise<void> {
  return invoke<void>('saves_open_folder', { game: game ?? null });
}

export function importExistingSaves(): Promise<SavesImportSummary> {
  return invoke<SavesImportSummary>('saves_import_existing');
}

/** One game (and its platform's shared cards), or every game when omitted. */
export function syncSavesNow(game?: SaveGameRef | null): Promise<SavesSyncReport> {
  return invoke<SavesSyncReport>('saves_sync_now', { game: game ?? null });
}

export async function onSavesChanged(callback: () => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen(SAVES_CHANGED_EVENT, () => callback());
}
