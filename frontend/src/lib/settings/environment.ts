import { readEnvConfig, writeEnvConfig, openEnvFolder } from '../tauri';

export async function initEnvironment(showToast: (msg?: string) => void) {
  const clientIdInput     = document.getElementById('igdb-client-id')     as HTMLInputElement;
  const clientSecretInput = document.getElementById('igdb-client-secret') as HTMLInputElement;
  const steamKeyInput     = document.getElementById('steam-api-key')      as HTMLInputElement;
  const tmdbKeyInput      = document.getElementById('tmdb-api-key')       as HTMLInputElement;
  const igdbSaveBtn       = document.getElementById('igdb-save-btn')!;
  const igdbClearBtn      = document.getElementById('igdb-clear-btn')!;
  const steamSaveBtn      = document.getElementById('steam-save-btn')!;
  const steamClearBtn     = document.getElementById('steam-clear-btn')!;
  const tmdbSaveBtn       = document.getElementById('tmdb-save-btn')!;
  const tmdbClearBtn      = document.getElementById('tmdb-clear-btn')!;
  const openFolderBtn     = document.getElementById('open-env-folder-btn')!;

  try {
    const cfg = await readEnvConfig();
    clientIdInput.value     = cfg.igdb_client_id     ?? '';
    clientSecretInput.value = cfg.igdb_client_secret ?? '';
    steamKeyInput.value     = cfg.steam_api_key      ?? '';
    tmdbKeyInput.value      = cfg.tmdb_api_key       ?? '';
  } catch {
    // Not in Tauri or file doesn't exist yet
  }

  igdbSaveBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({
        ...cfg,
        igdb_client_id:     clientIdInput.value.trim() || undefined,
        igdb_client_secret: clientSecretInput.value.trim() || undefined,
      });
      showToast('Claves de IGDB guardadas');
    } catch (err: any) {
      showToast('Error: ' + (err?.message ?? String(err)).slice(0, 60));
    }
  });

  igdbClearBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({ ...cfg, igdb_client_id: undefined, igdb_client_secret: undefined });
      clientIdInput.value     = '';
      clientSecretInput.value = '';
      showToast('Claves de IGDB eliminadas');
    } catch {
      showToast('Error al eliminar');
    }
  });

  steamSaveBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({ ...cfg, steam_api_key: steamKeyInput.value.trim() || undefined });
      showToast('Clave de Steam guardada');
    } catch (err: any) {
      showToast('Error: ' + (err?.message ?? String(err)).slice(0, 60));
    }
  });

  steamClearBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({ ...cfg, steam_api_key: undefined });
      steamKeyInput.value = '';
      showToast('Clave de Steam eliminada');
    } catch {
      showToast('Error al eliminar');
    }
  });

  tmdbSaveBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({ ...cfg, tmdb_api_key: tmdbKeyInput.value.trim() || undefined });
      showToast('Clave de TMDB guardada');
    } catch (err: any) {
      showToast('Error: ' + (err?.message ?? String(err)).slice(0, 60));
    }
  });

  tmdbClearBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({ ...cfg, tmdb_api_key: undefined });
      tmdbKeyInput.value = '';
      showToast('Clave de TMDB eliminada');
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
