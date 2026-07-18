import { getT } from '../../i18n/client';
import { byId } from '../shared/dom';
import { STORAGE_KEYS } from '../shared/storage-keys';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' &&
    ('__TAURI_IPC__' in window || '__TAURI_INTERNALS__' in window || '__TAURI__' in window);
}

// Manual trigger for the same merge BaseLayout.astro already runs
// automatically once a day (see syncCommunityCatalog there) — this button
// just lets a user force it on demand instead of waiting for the 24h
// throttle, and updates the same localStorage timestamp so the automatic
// check doesn't immediately re-run right after.
export function initCommunityCatalogSync() {
  const btn = byId<HTMLButtonElement>('community-catalog-sync-btn');
  const statusText = document.getElementById('community-catalog-sync-status');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const t = getT().settings;

    if (!isTauriRuntime()) {
      if (statusText) {
        statusText.textContent = 'Solo disponible en la aplicación instalada.';
        statusText.style.display = 'block';
      }
      return;
    }

    btn.disabled = true;
    btn.textContent = t.community_catalog_syncing;
    if (statusText) statusText.style.display = 'none';

    try {
      const { syncCommunityCatalog } = await import('../tauri');
      const imported = await syncCommunityCatalog();
      localStorage.setItem(STORAGE_KEYS.communityCatalogLastSync, String(Date.now()));

      if (statusText) {
        statusText.textContent = imported > 0
          ? t.community_catalog_sync_done
          : t.community_catalog_sync_none;
        statusText.style.display = 'block';
      }
    } catch (error) {
      if (statusText) {
        const message = error instanceof Error ? error.message : String(error) || 'Conexión fallida';
        statusText.textContent = t.community_catalog_sync_error.replace('{message}', message);
        statusText.style.display = 'block';
      }
    } finally {
      btn.disabled = false;
      btn.textContent = t.community_catalog_sync_btn;
    }
  });
}
