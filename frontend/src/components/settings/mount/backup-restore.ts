import { getT } from '../../../i18n/runtime';
import { formatAppError } from '../../../lib/errors/format-error';
import { exportBackup, pickBackupFile, pickSaveFile, prepareRestore } from '../../../lib/tauri/backup';

export function initBackupRestore() {
  const exportButton = document.getElementById('settings-backup-export-btn') as HTMLButtonElement | null;
  const importButton = document.getElementById('settings-backup-import-btn') as HTMLButtonElement | null;
  const status = document.getElementById('settings-backup-status');
  if (!exportButton || !importButton || !status || exportButton.dataset.initialized === 'true') return;
  exportButton.dataset.initialized = 'true';

  const setStatus = (message: string, error = false) => {
    status.textContent = message;
    status.classList.toggle('settings-backup-status--error', error);
  };

  exportButton.addEventListener('click', async () => {
    const t = getT();
    const destination = await pickSaveFile().catch(() => null);
    if (!destination) return;
    exportButton.disabled = true;
    try {
      await exportBackup(destination);
      setStatus(t.settings.backup_export_success);
    } catch (error) {
      setStatus(`${t.settings.backup_error}: ${formatAppError(error, t)}`, true);
    } finally {
      exportButton.disabled = false;
    }
  });

  importButton.addEventListener('click', async () => {
    const t = getT();
    const backupPath = await pickBackupFile().catch(() => null);
    if (!backupPath) return;
    const confirmed = window.confirm(t.settings.backup_import_confirm);
    if (!confirmed) return;
    importButton.disabled = true;
    try {
      await prepareRestore(backupPath);
      setStatus(t.settings.backup_import_success);
      window.setTimeout(async () => {
        const { relaunch } = await import('@tauri-apps/plugin-process');
        await relaunch();
      }, 900);
    } catch (error) {
      setStatus(`${t.settings.backup_error}: ${formatAppError(error, t)}`, true);
      importButton.disabled = false;
    }
  });
}
