// Settings › Backup: status lines, error wording and the restart that
// applies a prepared restore — shared by the local and Drive cards.
import { getT } from '../../../i18n/runtime';
import { formatAppError } from '../../../lib/errors/format-error';
import { interpolate } from '../../../lib/shared/text/interpolate';
import type { RestorePrepared } from '../../../lib/tauri/backup';

export type StatusSetter = (message: string, tone?: 'error' | 'success') => void;

export function statusSetter(element: HTMLElement | null): StatusSetter {
  return (message, tone) => {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('backup-status--error', tone === 'error');
    element.classList.toggle('backup-status--success', tone === 'success');
  };
}

/** "Cancelled." for a cancelled operation, the translated error otherwise. */
export function describeError(error: unknown): string {
  const t = getT();
  const text = formatAppError(error, t);
  if (String(error).startsWith('E_BACKUP_CANCELLED')) return t.backup.cancelled;
  return `${t.backup.error}: ${text}`;
}

export async function relaunchApp() {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/**
 * After a restore was staged: restart right away, unless credentials had to
 * be cleared — then say so and let the user restart when they have read it.
 */
export function afterRestorePrepared(result: RestorePrepared, setStatus: StatusSetter) {
  const t = getT();
  if (result.cleared_secrets > 0) {
    const notice = document.getElementById('backup-restart-notice');
    const text = document.getElementById('backup-restart-text');
    if (notice && text) {
      text.textContent = interpolate(t.backup.restore_secrets_cleared, { n: result.cleared_secrets });
      notice.hidden = false;
      document.getElementById('backup-restart-btn')?.focus();
      return;
    }
  }
  setStatus(t.backup.restore_ready, 'success');
  window.setTimeout(() => { void relaunchApp(); }, 900);
}
