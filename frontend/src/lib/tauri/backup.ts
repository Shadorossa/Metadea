import { tauriCmd, invoke } from './bridge';

/** Operation names carried by `backup://progress` events. */
export type BackupOperation = 'export' | 'restore' | 'drive_upload' | 'drive_download';

/** Phases a `backup://progress` event reports (see src-tauri/src/backup). */
export type BackupPhase =
  | 'snapshot' | 'hashing' | 'compress' | 'extract' | 'safety_backup' | 'upload' | 'download' | 'done';

export interface BackupProgress {
  operation: BackupOperation;
  phase: BackupPhase;
  percent: number;
}

export const BACKUP_PROGRESS_EVENT = 'backup://progress';
/** Emitted after a scheduled Drive backup ran (the status changed). */
export const DRIVE_STATE_EVENT = 'backup://drive-state';

export interface ExportResult {
  path: string;
  size: number;
  created_at: string;
  file_count: number;
}

export interface LocalBackupState {
  last_export: ExportResult | null;
}

export interface BackupInfo {
  /** `7z` (current) or `zip` (backups made before 0.7). */
  format: '7z' | 'zip';
  created_at: string;
  app_version: string | null;
  schema_version: number | null;
  file_count: number | null;
  total_size: number | null;
  archive_size: number;
  /** Game saves the backup carries (null: none, or a pre-0.7 backup). */
  saves_count: number | null;
  saves_size: number | null;
}

export interface RestorePrepared {
  safety_backup_path: string | null;
  /** Credentials encrypted on another machine, cleared by the restore. */
  cleared_secrets: number;
  created_at: string;
  /** Game saves merged into the saves folder / how many met a different local copy. */
  saves_restored: number;
  saves_conflicts: number;
}

export function pickBackupFile(): Promise<string | null> {
  return tauriCmd<string | null>('pick_backup_file', null);
}

export function pickSaveFile(): Promise<string | null> {
  return tauriCmd<string | null>('pick_save_file', null);
}

export function exportBackup(destinationPath: string): Promise<ExportResult> {
  return invoke<ExportResult>('export_backup', { destinationPath });
}

export function inspectBackup(backupPath: string): Promise<BackupInfo> {
  return invoke<BackupInfo>('inspect_backup', { backupPath });
}

export function prepareRestore(backupPath: string): Promise<RestorePrepared> {
  return invoke<RestorePrepared>('prepare_restore', { backupPath });
}

export function cancelBackupOperation(): Promise<boolean> {
  return invoke<boolean>('cancel_backup_operation');
}

export function getLocalBackupState(): Promise<LocalBackupState> {
  return invoke<LocalBackupState>('get_local_backup_state');
}

export async function onBackupProgress(callback: (progress: BackupProgress) => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen<BackupProgress>(BACKUP_PROGRESS_EVENT, event => callback(event.payload));
}

export async function onDriveStateChanged(callback: () => void): Promise<() => void> {
  const { listen } = await import('@tauri-apps/api/event');
  return listen(DRIVE_STATE_EVENT, () => callback());
}
