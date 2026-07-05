import { getT } from '../../i18n/client';
import { byId } from '../shared/dom';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' &&
    ('__TAURI_IPC__' in window || '__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

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
        statusText.textContent = 'Las actualizaciones solo están disponibles en la aplicación instalada.';
        statusText.style.display = 'block';
      }
      return;
    }

    const clientT = getT();
    checkBtn.disabled = true;
    checkBtn.textContent = clientT.settings.app_checking_update || 'Buscando...';
    if (statusText) statusText.style.display = 'none';

    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      const update = await check();
      if (update && update.available) {
        if (statusText) {
          statusText.textContent = 'Nueva actualización encontrada.';
          statusText.style.display = 'block';
        }
        const confirmMsg = (
          clientT.settings.app_update_found ||
          'Nueva versión {version} disponible. ¿Quieres instalarla?'
        ).replace('{version}', update.version);
        if (confirm(confirmMsg)) {
          await update.downloadAndInstall();
          await relaunch();
        }
      } else if (statusText) {
        statusText.textContent = clientT.settings.app_up_to_date || '¡Estás en la última versión!';
        statusText.style.display = 'block';
      }
    } catch (error: any) {
      console.error(error);
      if (statusText) {
        statusText.textContent = `Error al buscar actualizaciones: ${error?.message || error || 'Conexión fallida'}`;
        statusText.style.display = 'block';
      }
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = clientT.settings.app_check_update || 'Buscar actualizaciones';
    }
  });
}
