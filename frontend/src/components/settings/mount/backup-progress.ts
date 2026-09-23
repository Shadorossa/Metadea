// Settings › Backup: the shared progress bar fed by `backup://progress`
// events, the Cancel button, and the "an operation is running" lock on every
// `[data-backup-action]` button (Rust runs one backup operation at a time).
import { getT } from '../../../i18n/runtime';
import { progressLabelKey, progressPercent } from '../../../lib/backup/backup-settings';
import { cancelBackupOperation, onBackupProgress, type BackupProgress } from '../../../lib/tauri/backup';

export interface BackupProgressView {
  /** Shows the bar and locks the action buttons for the operation's duration. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

function render(progress: BackupProgress | null) {
  const label = document.getElementById('backup-progress-label');
  const percentText = document.getElementById('backup-progress-percent');
  const bar = document.getElementById('backup-progress-bar');
  const fill = document.getElementById('backup-progress-fill');
  if (!label || !percentText || !bar || !fill) return;
  const t = getT();
  const percent = progress ? progressPercent(progress.percent) : 0;
  label.textContent = t.backup[progressLabelKey(progress?.phase ?? '')];
  percentText.textContent = progress ? `${percent}%` : '';
  bar.setAttribute('aria-valuenow', String(percent));
  fill.style.width = `${percent}%`;
}

function setLocked(locked: boolean) {
  document.querySelectorAll<HTMLButtonElement>('#panel-backup [data-backup-action]').forEach(button => {
    button.disabled = locked;
  });
}

export function createBackupProgressView(): BackupProgressView {
  const container = document.getElementById('backup-progress');
  const cancelButton = document.getElementById('backup-cancel-btn') as HTMLButtonElement | null;
  let running = false;
  let unlisten: (() => void) | null = null;

  cancelButton?.addEventListener('click', () => {
    if (cancelButton) cancelButton.disabled = true;
    void cancelBackupOperation().catch(() => false);
  });

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      running = true;
      setLocked(true);
      render(null);
      if (container) container.hidden = false;
      if (cancelButton) cancelButton.disabled = false;
      // Progress is decoration: a failed subscription still runs the task.
      unlisten = await onBackupProgress(progress => {
        if (running) render(progress);
      }).catch(() => null);
      try {
        return await task();
      } finally {
        running = false;
        unlisten?.();
        unlisten = null;
        if (container) container.hidden = true;
        setLocked(false);
      }
    },
  };
}
