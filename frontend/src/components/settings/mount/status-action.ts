import { byId } from '../../../lib/dom/dom';
import { getT } from '../../../i18n/runtime';
import { formatAppError } from '../../../lib/errors/format-error';

// Tauri's own init scripts inject one of these globals; __TAURI_INTERNALS__
// is the v2 name, kept alongside the v1 ones so a bridge that only exposes
// the new global still counts as "running inside the app".
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' &&
    ('__TAURI_IPC__' in window || '__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

interface StatusActionOptions {
  buttonId: string;
  statusId: string;
  notInTauriMessage: string;
  // Read at click time, not at wiring time — the language can change after
  // this button was wired up.
  labels: () => { running: string; idle: string };
  run: () => Promise<string>;
  errorMessage: (message: string) => string;
  errorFallback: string;
}

// The "disable the button, swap it to a running label, report the outcome in
// its own status line, restore it either way" wiring shared by every
// maintenance button in Ajustes.
export function initStatusActionButton(options: StatusActionOptions): void {
  const btn = byId<HTMLButtonElement>(options.buttonId);
  const statusText = document.getElementById(options.statusId);
  if (!btn) return;

  const showStatus = (text: string) => {
    if (!statusText) return;
    statusText.textContent = text;
    statusText.style.display = 'block';
  };

  btn.addEventListener('click', async () => {
    if (!isTauriRuntime()) {
      showStatus(options.notInTauriMessage);
      return;
    }

    const { running, idle } = options.labels();
    btn.disabled = true;
    btn.textContent = running;
    if (statusText) statusText.style.display = 'none';

    try {
      showStatus(await options.run());
    } catch (error) {
      const message = formatAppError(error, getT()) || options.errorFallback;
      showStatus(options.errorMessage(message));
    } finally {
      btn.disabled = false;
      btn.textContent = idle;
    }
  });
}
