import { readEnvConfig, writeEnvConfig, openEnvFolder, readRoutes, writeRoutes, pickFolder } from '../tauri';

const LOCAL_ROUTE_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'visual-novel', label: 'Novela visual' },
  { id: 'anime',        label: 'Anime' },
  { id: 'manga',        label: 'Manga' },
  { id: 'light-novel',  label: 'Novela Ligera' },
  { id: 'books',        label: 'Libros' },
  { id: 'series',       label: 'Series' },
  { id: 'movies',       label: 'Películas' },
];

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
        row.style.cssText = 'display: flex; align-items: center; gap: 0.5rem;';
        row.innerHTML = `
          <span style="flex: 0 0 130px; font-size: 0.8rem; color: var(--text-main); font-weight: 500;">${cat.label}</span>
          <input
            type="text"
            readonly
            value="${path.replace(/"/g, '&quot;')}"
            placeholder="Sin ruta"
            style="flex: 1; font-size: 0.75rem; background: var(--bg-input, var(--bg-card)); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 0.3rem 0.5rem; color: var(--text-main); cursor: default; min-width: 0;"
            data-route-id="${cat.id}"
          />
          <button class="btn btn--sm btn--secondary" data-pick="${cat.id}" style="flex-shrink: 0; padding: 0.25rem 0.5rem; font-size: 0.75rem;" title="Seleccionar carpeta">📁</button>
          ${path ? `<button class="btn btn--sm btn--ghost" data-clear="${cat.id}" style="flex-shrink: 0; padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--color-error, #ff6b6b);" title="Quitar ruta">✕</button>` : ''}
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
