// Google Drive backups (src-tauri/src/google_drive). Uploads land in the
// account's app-private appDataFolder, invisible in the Drive UI.
import { invoke } from './bridge';
import type { RestorePrepared } from './backup';
import type { DriveSchedule } from '../backup/backup-settings';

export interface DriveAccount {
  email: string;
  name: string;
  photoUrl: string | null;
}

export interface DriveStatus {
  /** A Google OAuth client id is available (build-time or Environment override). */
  configured: boolean;
  linked: boolean;
  account: DriveAccount | null;
  schedule: DriveSchedule;
  keepLast: number;
  lastUploadAt: string | null;
  lastUploadSize: number | null;
  lastCheckAt: string | null;
  /** `E_*` code (with detail) of the last failed upload, if any. */
  lastError: string | null;
}

export interface RemoteBackup {
  id: string;
  name: string;
  size: number;
  createdAt: string;
  appVersion: string | null;
}

/** Text of the browser tab shown after Google redirects back. */
export interface LoopbackPage {
  title: string;
  body: string;
}

export function driveStatus(): Promise<DriveStatus> {
  return invoke<DriveStatus>('google_drive_status');
}

/** `loginHint`: the Metadea account's Google email, so Google opens on that
 *  account and the link is one consent screen (see accountEmailHint). */
export function driveLink(page: LoopbackPage, loginHint?: string | null): Promise<DriveStatus> {
  return invoke<DriveStatus>('google_drive_link', { page, loginHint: loginHint ?? null });
}

export function driveCancelLink(): Promise<boolean> {
  return invoke<boolean>('google_drive_cancel_link');
}

export function driveUnlink(): Promise<DriveStatus> {
  return invoke<DriveStatus>('google_drive_unlink');
}

export function driveSetOptions(schedule: DriveSchedule, keepLast: number): Promise<DriveStatus> {
  return invoke<DriveStatus>('google_drive_set_options', { options: { schedule, keepLast } });
}

export function driveList(): Promise<RemoteBackup[]> {
  return invoke<RemoteBackup[]>('google_drive_list');
}

export function driveUploadNow(): Promise<RemoteBackup> {
  return invoke<RemoteBackup>('google_drive_upload_now');
}

export function driveRestore(fileId: string, size: number): Promise<RestorePrepared> {
  return invoke<RestorePrepared>('google_drive_restore', { fileId, size });
}
