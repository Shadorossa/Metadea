// Settings › Emulators › Saves (central folder, versions kept, import) and
// Settings › Backup › "Sync emulator saves to Google Drive". Both edit the
// same SavesSettings (src-tauri/src/saves/mod.rs); see docs/SAVES.md.
import { getT } from '../../../i18n/runtime';
import { formatAppError } from '../../../lib/errors/format-error';
import { formatBytes } from '../../../lib/backup/backup-settings';
import { interpolate } from '../../../lib/shared/text/interpolate';
import { parseHistoryKeep } from '../../../lib/local/save-format';
import { pickFolder } from '../../../lib/tauri/local-library';
import {
  getSavesBackupEstimate, getSavesSettings, importExistingSaves, openSavesFolder, setSavesSettings, syncSavesNow,
  type SavesSettings, type SavesStatus,
} from '../../../lib/tauri/saves';
import { formatBackupDate } from './backup-confirm';

function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

let current: SavesStatus | null = null;

function settingsFrom(status: SavesStatus, change: Partial<SavesSettings>): SavesSettings {
  return {
    root: status.customRoot ? status.root : null,
    driveSync: status.driveSync,
    historyKeep: status.historyKeep,
    includeInBackup: status.includeInBackup,
    ...change,
  };
}

function render(status: SavesStatus) {
  current = status;
  const t = getT();
  const path = byId('saves-root-path');
  if (path) {
    path.textContent = status.root;
    // The field truncates long paths; its tooltip always has the full one.
    (path.closest<HTMLElement>('.saves-settings-path') ?? path).title = status.root;
  }
  const reset = byId('saves-root-reset');
  if (reset) reset.hidden = !status.customRoot;
  const keep = byId<HTMLInputElement>('saves-history-keep');
  if (keep && document.activeElement !== keep) keep.value = String(status.historyKeep);
  const toggle = byId<HTMLInputElement>('saves-drive-toggle');
  if (toggle) toggle.checked = status.driveSync;
  const include = byId<HTMLInputElement>('saves-backup-include');
  if (include) include.checked = status.includeInBackup;
  const last = byId('saves-drive-last');
  if (last) {
    last.removeAttribute('data-i18n');
    const lines = [status.lastSyncAt
      ? interpolate(t.saves.drive_last_sync, { date: formatBackupDate(status.lastSyncAt) })
      : t.saves.drive_last_sync_never];
    if (status.lastSyncError) lines.push(interpolate(t.saves.drive_sync_error, { error: formatAppError(status.lastSyncError, t) }));
    last.textContent = lines.join(' · ');
  }
}

async function renderEstimate() {
  const element = byId('saves-backup-estimate');
  if (!element) return;
  const estimate = await getSavesBackupEstimate().catch(() => null);
  if (!estimate) {
    element.textContent = '';
    return;
  }
  const t = getT();
  element.textContent = estimate.files > 0
    ? interpolate(t.saves.backup_estimate, { count: estimate.files, size: formatBytes(estimate.bytes) })
    : t.saves.backup_estimate_empty;
}

function setText(id: string, text: string, isError = false) {
  const element = byId(id);
  if (!element) return;
  element.textContent = text;
  element.classList.toggle('saves-settings-status--error', isError && id === 'saves-import-status');
  element.classList.toggle('backup-status--error', isError && id === 'saves-drive-status');
}

async function save(change: Partial<SavesSettings>, showToast: (msg?: string) => void, statusId = 'saves-import-status') {
  if (!current) return;
  try {
    render(await setSavesSettings(settingsFrom(current, change)));
    showToast();
  } catch (error) {
    setText(statusId, formatAppError(error, getT()), true);
    if (current) render(current);
  }
}

export function initSavesSettings(showToast: (msg?: string) => void) {
  const panel = byId('saves-settings');
  if (!panel || panel.dataset.initialized === 'true') return;
  panel.dataset.initialized = 'true';

  void renderEstimate();
  void getSavesSettings()
    .then(render)
    .catch(error => setText('saves-import-status', formatAppError(error, getT()), true));

  byId('saves-root-change')?.addEventListener('click', async () => {
    const chosen = await pickFolder().catch(() => null);
    if (chosen) await save({ root: chosen }, showToast);
    void renderEstimate();
  });
  byId('saves-root-reset')?.addEventListener('click', () => { void save({ root: null }, showToast).then(renderEstimate); });
  byId('saves-root-open')?.addEventListener('click', () => {
    openSavesFolder().catch(error => setText('saves-import-status', formatAppError(error, getT()), true));
  });
  byId<HTMLInputElement>('saves-history-keep')?.addEventListener('change', event => {
    const input = event.currentTarget as HTMLInputElement;
    const historyKeep = parseHistoryKeep(input.value);
    input.value = String(historyKeep);
    void save({ historyKeep }, showToast);
  });

  const importButton = byId<HTMLButtonElement>('saves-import-btn');
  importButton?.addEventListener('click', async () => {
    const t = getT();
    importButton.disabled = true;
    setText('saves-import-status', t.saves.importing);
    try {
      const summary = await importExistingSaves();
      setText('saves-import-status', summary.captured > 0
        ? interpolate(t.saves.import_done, { files: summary.captured, games: summary.games })
        : t.saves.import_none);
    } catch (error) {
      setText('saves-import-status', formatAppError(error, t), true);
    } finally {
      importButton.disabled = false;
      void renderEstimate();
    }
  });

  byId<HTMLInputElement>('saves-backup-include')?.addEventListener('change', event => {
    void save({ includeInBackup: (event.currentTarget as HTMLInputElement).checked }, showToast, 'saves-drive-status');
  });

  byId<HTMLInputElement>('saves-drive-toggle')?.addEventListener('change', event => {
    void save({ driveSync: (event.currentTarget as HTMLInputElement).checked }, showToast, 'saves-drive-status');
  });

  const syncButton = byId<HTMLButtonElement>('saves-drive-sync-btn');
  syncButton?.addEventListener('click', async () => {
    const t = getT();
    syncButton.disabled = true;
    setText('saves-drive-status', t.saves.syncing);
    try {
      const report = await syncSavesNow();
      const parts = [interpolate(t.saves.sync_done, { up: report.uploaded, down: report.downloaded })];
      if (report.conflicts > 0) parts.push(interpolate(t.saves.sync_conflicts, { n: report.conflicts }));
      setText('saves-drive-status', parts.join(' · '));
    } catch (error) {
      setText('saves-drive-status', formatAppError(error, t), true);
    } finally {
      syncButton.disabled = false;
      const fresh = await getSavesSettings().catch(() => null);
      if (fresh) render(fresh);
    }
  });
}
