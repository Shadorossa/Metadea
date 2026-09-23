// Settings › Backup: the "replace my data?" confirmation before a restore.
// A native modal <dialog> gives focus trapping, Escape and the backdrop;
// focus goes back to the button that opened it.
import { getT } from '../../../i18n/runtime';
import { formatBytes } from '../../../lib/backup/backup-settings';
import { formatDateTimeShort } from '../../../lib/shared/text/format-date';
import { interpolate } from '../../../lib/shared/text/interpolate';
import type { BackupInfo } from '../../../lib/tauri/backup';

export interface RestoreSummary {
  createdAt: string;
  appVersion: string | null;
  fileCount: number | null;
  size: number | null;
  legacy: boolean;
  savesCount?: number | null;
  savesSize?: number | null;
}

export function summaryFromInfo(info: BackupInfo): RestoreSummary {
  return {
    createdAt: info.created_at,
    appVersion: info.app_version,
    fileCount: info.file_count,
    size: info.total_size ?? info.archive_size,
    legacy: info.format === 'zip',
    savesCount: info.saves_count ?? null,
    savesSize: info.saves_size ?? null,
  };
}

export function formatBackupDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatDateTimeShort(date);
}

export function confirmRestore(summary: RestoreSummary, trigger: HTMLElement | null): Promise<boolean> {
  const dialog = document.getElementById('backup-confirm-dialog') as HTMLDialogElement | null;
  const accept = document.getElementById('backup-confirm-accept');
  const cancel = document.getElementById('backup-confirm-cancel');
  const dateEl = document.getElementById('backup-confirm-date');
  const metaEl = document.getElementById('backup-confirm-meta');
  if (!dialog || !accept || !cancel || !dateEl || !metaEl || typeof dialog.showModal !== 'function') {
    return Promise.resolve(false);
  }
  const t = getT();
  dateEl.textContent = interpolate(t.backup.confirm_details, { date: formatBackupDate(summary.createdAt) });
  metaEl.textContent = summary.legacy
    ? t.backup.confirm_legacy
    : interpolate(t.backup.confirm_details_meta, {
      version: summary.appVersion ?? '?',
      count: summary.fileCount ?? 0,
      size: formatBytes(summary.size),
    });
  if (summary.savesCount) {
    metaEl.textContent += ` · ${interpolate(t.saves.confirm_saves, { count: summary.savesCount, size: formatBytes(summary.savesSize) })}`;
  }

  return new Promise(resolve => {
    const finish = (accepted: boolean) => {
      accept.removeEventListener('click', onAccept);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      trigger?.focus();
      resolve(accepted);
    };
    const onAccept = () => finish(true);
    const onCancel = () => finish(false);
    // Escape closes the dialog natively; that counts as "keep my data".
    const onClose = () => finish(false);
    accept.addEventListener('click', onAccept);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('close', onClose);
    dialog.showModal();
    // The safe choice has focus, so Enter never replaces data by accident.
    cancel.focus();
  });
}
