// Settings › Backup › Local backup: export a .7z through the save dialog,
// restore a .7z (or an old .zip) after the confirmation dialog, and the
// restart that applies a prepared restore. Drive lives in backup-drive.ts.
import { getT } from '../../../i18n/runtime';
import { formatBytes } from '../../../lib/backup/backup-settings';
import { interpolate } from '../../../lib/shared/text/interpolate';
import {
  exportBackup, getLocalBackupState, inspectBackup, pickBackupFile, pickSaveFile, prepareRestore,
  type ExportResult,
} from '../../../lib/tauri/backup';
import { confirmRestore, formatBackupDate, summaryFromInfo } from './backup-confirm';
import { createBackupProgressView, type BackupProgressView } from './backup-progress';
import { initDriveBackup } from './backup-drive';
import { afterRestorePrepared, describeError, relaunchApp, statusSetter } from './backup-status';

function renderLastExport(last: ExportResult | null) {
  const element = document.getElementById('backup-local-last');
  if (!element) return;
  const t = getT();
  if (!last) {
    element.textContent = t.backup.last_export_never;
    return;
  }
  element.removeAttribute('data-i18n');
  element.textContent = interpolate(t.backup.last_export, { date: formatBackupDate(last.created_at), size: formatBytes(last.size) });
  element.title = last.path;
}

function initLocalCard(progress: BackupProgressView) {
  const exportButton = document.getElementById('backup-export-btn') as HTMLButtonElement | null;
  const importButton = document.getElementById('backup-import-btn') as HTMLButtonElement | null;
  const setStatus = statusSetter(document.getElementById('backup-local-status'));
  if (!exportButton || !importButton) return;

  getLocalBackupState().then(state => renderLastExport(state.last_export)).catch(() => {});

  exportButton.addEventListener('click', async () => {
    const destination = await pickSaveFile().catch(() => null);
    if (!destination) return;
    setStatus('');
    try {
      const result = await progress.run(() => exportBackup(destination));
      renderLastExport(result);
      setStatus(interpolate(getT().backup.export_success, { size: formatBytes(result.size) }), 'success');
    } catch (error) {
      setStatus(describeError(error), 'error');
    }
  });

  importButton.addEventListener('click', async () => {
    const backupPath = await pickBackupFile().catch(() => null);
    if (!backupPath) return;
    setStatus('');
    try {
      const info = await inspectBackup(backupPath);
      if (!(await confirmRestore(summaryFromInfo(info), importButton))) return;
      const result = await progress.run(() => prepareRestore(backupPath));
      afterRestorePrepared(result, setStatus);
    } catch (error) {
      setStatus(describeError(error), 'error');
    }
  });
}

export function initBackupRestore() {
  const panel = document.getElementById('panel-backup');
  if (!panel || panel.dataset.initialized === 'true') return;
  panel.dataset.initialized = 'true';

  const progress = createBackupProgressView();
  document.getElementById('backup-restart-btn')?.addEventListener('click', () => { void relaunchApp(); });
  initLocalCard(progress);
  initDriveBackup(progress);
}
