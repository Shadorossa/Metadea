import { readEnvConfig, writeEnvConfig, openEnvFolder, readRoutes, writeRoutes, pickFolder } from '../tauri';
import { CATEGORIES } from '../../components/local/utils/constants';
import { ICON_FOLDER, ICON_X_SMALL } from '../shared/icon-strings';

// Local folder routes cover every category except 'videojuegos' (games use
// Steam/local scan instead of a folder route) — reuse the shared category
// list instead of keeping a second, drifting copy of the same labels.
const LOCAL_ROUTE_CATEGORIES = CATEGORIES.filter(c => c.id !== 'videojuegos');

export async function initEnvironment(showToast: (msg?: string) => void) {
  const clientIdInput        = document.getElementById('igdb-client-id')         as HTMLInputElement;
  const clientSecretInput    = document.getElementById('igdb-client-secret')     as HTMLInputElement;
  const steamKeyInput        = document.getElementById('steam-api-key')          as HTMLInputElement;
  const tmdbAccessTokenInput = document.getElementById('tmdb-access-token')      as HTMLInputElement;
  const tmdbKeyInput         = document.getElementById('tmdb-api-key')           as HTMLInputElement;
  const anilistClientIdInput = document.getElementById('anilist-client-id')       as HTMLInputElement;
  const envSaveBtn           = document.getElementById('env-save-btn')!;
  const envClearBtn          = document.getElementById('env-clear-btn')!;
  const openFolderBtn        = document.getElementById('open-env-folder-btn')!;

  try {
    const cfg = await readEnvConfig();
    clientIdInput.value        = cfg.igdb_client_id     ?? '';
    clientSecretInput.value    = cfg.igdb_client_secret ?? '';
    steamKeyInput.value        = cfg.steam_api_key      ?? '';
    tmdbAccessTokenInput.value = cfg.tmdb_access_token  ?? '';
    tmdbKeyInput.value         = cfg.tmdb_api_key       ?? '';
    anilistClientIdInput.value = cfg.anilist_client_id  ?? '';
  } catch {
    // Not in Tauri or file doesn't exist yet
  }

  envSaveBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({
        ...cfg,
        igdb_client_id:     clientIdInput.value.trim() || undefined,
        igdb_client_secret: clientSecretInput.value.trim() || undefined,
        steam_api_key:      steamKeyInput.value.trim() || undefined,
        tmdb_access_token:  tmdbAccessTokenInput.value.trim() || undefined,
        tmdb_api_key:       tmdbKeyInput.value.trim() || undefined,
        anilist_client_id:  anilistClientIdInput.value.trim() || undefined,
      });
      showToast('Credenciales guardadas');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('Error: ' + message.slice(0, 60));
    }
  });

  envClearBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({
        ...cfg,
        igdb_client_id: undefined,
        igdb_client_secret: undefined,
        steam_api_key: undefined,
        tmdb_access_token: undefined,
        tmdb_api_key: undefined,
        anilist_client_id: undefined,
      });
      clientIdInput.value = '';
      clientSecretInput.value = '';
      steamKeyInput.value = '';
      tmdbAccessTokenInput.value = '';
      tmdbKeyInput.value = '';
      anilistClientIdInput.value = '';
      showToast('Credenciales eliminadas');
    } catch {
      showToast('Error al eliminar');
    }
  });

  openFolderBtn.addEventListener('click', async () => {
    try {
      await openEnvFolder();
      showToast('Carpeta abierta');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast('Error: ' + message.slice(0, 60));
    }
  });

  // ── Local routes ────────────────────────────────────────────────────────────
  const routesList = document.getElementById('local-routes-list');
  if (routesList) {
    let routes: Record<string, string> = {};

    function renderRoutes() {
      if (!routesList) return;
      routesList.innerHTML = '';
      for (const cat of LOCAL_ROUTE_CATEGORIES) {
        const path = routes[cat.id] ?? '';
        const row = document.createElement('div');
        row.className = 'local-route-row';
        row.innerHTML = `
          <span class="local-route-label">${cat.label}</span>
          <input
            type="text"
            readonly
            value="${path.replace(/"/g, '&quot;')}"
            placeholder="Sin ruta"
            class="local-route-input"
            data-route-id="${cat.id}"
          />
          <button class="local-route-btn" data-pick="${cat.id}" title="Seleccionar carpeta">${ICON_FOLDER}</button>
          ${path ? `<button class="local-route-btn local-route-btn--danger" data-clear="${cat.id}" title="Quitar ruta">${ICON_X_SMALL}</button>` : '<span class="local-route-btn-spacer"></span>'}
        `;
        routesList.appendChild(row);
      }
    }

    readRoutes().then(r => { routes = r; renderRoutes(); }).catch(() => {});

    routesList.addEventListener('click', async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!btn) return;

      const pickId = btn.dataset.pick;
      const clearId = btn.dataset.clear;

      if (pickId) {
        const chosen = await pickFolder().catch(() => null);
        if (!chosen) return;
        routes = { ...routes, [pickId]: chosen };
        try {
          await writeRoutes(routes);
          renderRoutes();
          showToast('Ruta guardada');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          showToast('Error al guardar: ' + message.slice(0, 50));
        }
      } else if (clearId) {
        const updated = { ...routes };
        delete updated[clearId];
        routes = updated;
        try {
          await writeRoutes(routes);
          renderRoutes();
          showToast('Ruta eliminada');
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          showToast('Error al eliminar: ' + message.slice(0, 50));
        }
      }
    });
  }
}
