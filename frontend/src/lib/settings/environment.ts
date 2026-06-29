import { readEnvConfig, writeEnvConfig, openEnvFolder } from '../tauri';

export async function initEnvironment(showToast: (msg?: string) => void) {
  const clientIdInput        = document.getElementById('igdb-client-id')         as HTMLInputElement;
  const clientSecretInput    = document.getElementById('igdb-client-secret')     as HTMLInputElement;
  const steamKeyInput        = document.getElementById('steam-api-key')          as HTMLInputElement;
  const tmdbAccessTokenInput = document.getElementById('tmdb-access-token')      as HTMLInputElement;
  const tmdbKeyInput         = document.getElementById('tmdb-api-key')           as HTMLInputElement;
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
      });
      showToast('Credenciales guardadas');
    } catch (err: any) {
      showToast('Error: ' + (err?.message ?? String(err)).slice(0, 60));
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
      });
      clientIdInput.value = '';
      clientSecretInput.value = '';
      steamKeyInput.value = '';
      tmdbAccessTokenInput.value = '';
      tmdbKeyInput.value = '';
      showToast('Credenciales eliminadas');
    } catch {
      showToast('Error al eliminar');
    }
  });

  openFolderBtn.addEventListener('click', async () => {
    try {
      await openEnvFolder();
      showToast('Carpeta abierta');
    } catch (err: any) {
      showToast('Error: ' + (err?.message ?? String(err)).slice(0, 60));
    }
  });
}
