import { getT } from '../../i18n/client';
import { STORAGE_KEYS } from '../shared/storage-keys';
import { initStatusActionButton } from './status-action';

// Manual trigger for the same merge BaseLayout.astro already runs
// automatically once a day (see syncCommunityCatalog there) — this button
// just lets a user force it on demand instead of waiting for the 24h
// throttle, and updates the same localStorage timestamp so the automatic
// check doesn't immediately re-run right after.
export function initCommunityCatalogSync() {
  initStatusActionButton({
    buttonId: 'community-catalog-sync-btn',
    statusId: 'community-catalog-sync-status',
    notInTauriMessage: 'Solo disponible en la aplicación instalada.',
    labels: () => {
      const t = getT().settings;
      return { running: t.community_catalog_syncing, idle: t.community_catalog_sync_btn };
    },
    run: async () => {
      const { syncCommunityCatalog } = await import('../tauri');
      const imported = await syncCommunityCatalog();
      localStorage.setItem(STORAGE_KEYS.communityCatalogLastSync, String(Date.now()));
      const t = getT().settings;
      return imported > 0 ? t.community_catalog_sync_done : t.community_catalog_sync_none;
    },
    errorMessage: message => getT().settings.community_catalog_sync_error.replace('{message}', message),
    errorFallback: 'Conexión fallida',
  });
}
