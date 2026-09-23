import { tauriCmd, invoke } from './bridge';

export function pickBackupFile(): Promise<string | null> {
  return tauriCmd<string | null>('pick_backup_file', null);
}

export function pickSaveFile(): Promise<string | null> {
  return tauriCmd<string | null>('pick_save_file', null);
}

export function exportBackup(destinationPath: string): Promise<string> {
  return invoke<string>('export_backup', { destinationPath });
}

export function prepareRestore(backupPath: string): Promise<string> {
  return invoke<string>('prepare_restore', { backupPath });
}
