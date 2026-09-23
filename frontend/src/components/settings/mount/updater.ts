import { getT } from '../../../i18n/runtime';
import { interpolateTranslation } from '../../../lib/i18n-dom/apply-translations';
import { byId } from '../../../lib/dom/dom';
import { isTauriRuntime } from './status-action';

export function initUpdater(defaultVersionFallback: string) {
  const checkBtn = byId<HTMLButtonElement>('app-check-update-btn');
  const statusText = document.getElementById('updater-status-text');
  const versionSpan = document.querySelector<HTMLElement>('.app-curr-ver');
  const isTauri = isTauriRuntime();

  if (isTauri) {
    import('@tauri-apps/api/app')
      .then(async ({ getVersion }) => {
        const currentVersion = await getVersion();
        if (versionSpan) versionSpan.textContent = `v${currentVersion}`;
      })
      .catch(() => {
        if (versionSpan) versionSpan.textContent = `v${defaultVersionFallback}`;
      });
  } else if (versionSpan) {
    versionSpan.textContent = `v${defaultVersionFallback}`;
  }

  if (!checkBtn) return;

  checkBtn.addEventListener('click', async () => {
    if (!isTauri) {
      if (statusText) {
        statusText.textContent = getT().settings.updates_desktop_only;
        statusText.style.display = 'block';
      }
      return;
    }

    const clientT = getT();
    checkBtn.disabled = true;
    checkBtn.textContent = clientT.settings.app_checking_update;
    if (statusText) statusText.style.display = 'none';

    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const update = await check();
      if (update && update.available) {
        if (statusText) {
          statusText.textContent = clientT.settings.update_found_status;
          statusText.style.display = 'block';
        }
        const confirmMsg = interpolateTranslation(clientT.settings.app_update_found, { version: update.version });
        if (confirm(confirmMsg)) {
          await update.downloadAndInstall();
          await relaunch();
        }
      } else if (statusText) {
        statusText.textContent = clientT.settings.app_up_to_date;
        statusText.style.display = 'block';
      }
    } catch (error) {
      console.error(error);
      if (statusText) {
        const message = error instanceof Error ? error.message : String(error) || clientT.settings.update_connection_failed;
        statusText.textContent = interpolateTranslation(clientT.settings.update_check_error, { message });
        statusText.style.display = 'block';
      }
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = clientT.settings.app_check_update;
    }
  });
}
