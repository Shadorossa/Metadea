import { readEnvConfig, writeEnvConfig, openEnvFolder, readRoutes, writeRoutes, pickFolder, type EnvConfig } from '../../../lib/tauri';
import { CATEGORIES } from '../../../lib/local/platforms';
import { ICON_FOLDER, ICON_X_SMALL } from '../../../lib/dom/icon-strings';
import { escapeHtml } from '../../../lib/shared/text/sanitize-html';
import { LOCAL_CATEGORY_TO_SEARCH_TYPE } from '../../../lib/local/platforms';
import { getT } from '../../../i18n/runtime';

// Local folder routes cover every category except 'videojuegos' (games use
// Steam/local scan instead of a folder route) — reuse the shared category
// list instead of keeping a second, drifting copy of the same labels.
const LOCAL_ROUTE_CATEGORIES = CATEGORIES.filter(c => c.id !== 'videojuegos');

// Each credential field's config key paired with the input element holding
// it — the load, save and clear paths all walk this one list instead of
// repeating the same eight assignments three times over.
const ENV_FIELDS: Array<[keyof EnvConfig, string]> = [
  ['igdb_client_id',     'igdb-client-id'],
  ['igdb_client_secret', 'igdb-client-secret'],
  ['steam_api_key',      'steam-api-key'],
  ['tmdb_access_token',  'tmdb-access-token'],
  ['tmdb_api_key',       'tmdb-api-key'],
  ['anilist_client_id',  'anilist-client-id'],
  ['comicvine_api_key',  'comicvine-api-key'],
  ['apisports_api_key',  'apisports-api-key'],
  ['ra_username',        'ra-username'],
  ['ra_api_key',         'ra-api-key'],
  ['mal_client_id',      'mal-client-id'],
];

export async function initEnvironment(showToast: (msg?: string) => void) {
  const inputs = new Map<keyof EnvConfig, HTMLInputElement>(
    ENV_FIELDS.map(([key, id]) => [key, document.getElementById(id) as HTMLInputElement]),
  );
  const envSaveBtn           = document.getElementById('env-save-btn')!;
  const envClearBtn          = document.getElementById('env-clear-btn')!;
  const openFolderBtn        = document.getElementById('open-env-folder-btn')!;

  try {
    const cfg = await readEnvConfig();
    for (const [key, input] of inputs) input.value = cfg[key] ?? '';
  } catch {
    // Not in Tauri or file doesn't exist yet
  }

  const writeFields = async (valueFor: (input: HTMLInputElement) => string | undefined) => {
    const cfg = await readEnvConfig().catch(() => ({}));
    const updated: EnvConfig = { ...cfg };
    for (const [key, input] of inputs) updated[key] = valueFor(input);
    await writeEnvConfig(updated);
  };

  envSaveBtn.addEventListener('click', async () => {
    try {
      await writeFields(input => input.value.trim() || undefined);
      showToast(getT().settings.env_credentials_saved);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(getT().settings.error_with_message.replace('{message}', message.slice(0, 60)));
    }
  });

  envClearBtn.addEventListener('click', async () => {
    try {
      await writeFields(() => undefined);
      for (const input of inputs.values()) input.value = '';
      showToast(getT().settings.env_credentials_cleared);
    } catch {
      showToast(getT().settings.delete_error);
    }
  });

  openFolderBtn.addEventListener('click', async () => {
    try {
      await openEnvFolder();
      showToast(getT().settings.env_folder_opened);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(getT().settings.error_with_message.replace('{message}', message.slice(0, 60)));
    }
  });

  // ── Local routes ────────────────────────────────────────────────────────────
  const routesList = document.getElementById('local-routes-list');
  if (routesList) {
    let routes: Record<string, string> = {};

    function renderRoutes() {
      if (!routesList) return;
      routesList.innerHTML = '';
      const t = getT();
      for (const cat of LOCAL_ROUTE_CATEGORIES) {
        const path = routes[cat.id] ?? '';
        const row = document.createElement('div');
        row.className = 'local-route-row';
        row.innerHTML = `
          <span class="local-route-label">${escapeHtml(t.search.types[LOCAL_CATEGORY_TO_SEARCH_TYPE[cat.id]])}</span>
          <input
            type="text"
            readonly
            value="${path.replace(/"/g, '&quot;')}"
            placeholder="${escapeHtml(t.settings.local_route_empty_ph)}"
            class="local-route-input"
            data-route-id="${cat.id}"
          />
          <button class="local-route-btn" data-pick="${cat.id}" title="${escapeHtml(t.settings.local_route_pick)}">${ICON_FOLDER}</button>
          ${path ? `<button class="local-route-btn local-route-btn--danger" data-clear="${cat.id}" title="${escapeHtml(t.local.remove_route)}">${ICON_X_SMALL}</button>` : '<span class="local-route-btn-spacer"></span>'}
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
          showToast(getT().settings.local_route_saved);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          showToast(getT().settings.save_error_with_message.replace('{message}', message.slice(0, 50)));
        }
      } else if (clearId) {
        const updated = { ...routes };
        delete updated[clearId];
        routes = updated;
        try {
          await writeRoutes(routes);
          renderRoutes();
          showToast(getT().settings.local_route_removed);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          showToast(getT().settings.delete_error_with_message.replace('{message}', message.slice(0, 50)));
        }
      }
    });
  }
}
