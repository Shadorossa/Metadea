import { readEnvConfig, writeEnvConfig, openEnvFolder } from '../tauri';

export async function initEnvironment(showToast: (msg?: string) => void) {
  const clientIdInput       = document.getElementById('igdb-client-id')         as HTMLInputElement | null;
  const clientSecretInput   = document.getElementById('igdb-client-secret')     as HTMLInputElement | null;
  const steamKeyInput       = document.getElementById('steam-api-key')          as HTMLInputElement | null;
  const tmdbAccessTokenInput = document.getElementById('tmdb-access-token')     as HTMLInputElement | null;
  const tmdbKeyInput        = document.getElementById('tmdb-api-key')           as HTMLInputElement | null;
  const igdbSaveBtn         = document.getElementById('igdb-save-btn');
  const igdbClearBtn        = document.getElementById('igdb-clear-btn');
  const steamSaveBtn        = document.getElementById('steam-save-btn');
  const steamClearBtn       = document.getElementById('steam-clear-btn');
  const tmdbSaveBtn         = document.getElementById('tmdb-save-btn');
  const tmdbClearBtn        = document.getElementById('tmdb-clear-btn');
  const openFolderBtn       = document.getElementById('open-env-folder-btn');

  try {
    const cfg = await readEnvConfig();
    if (clientIdInput) clientIdInput.value       = cfg.igdb_client_id       ?? '';
    if (clientSecretInput) clientSecretInput.value   = cfg.igdb_client_secret   ?? '';
    if (steamKeyInput) steamKeyInput.value       = cfg.steam_api_key        ?? '';
    if (tmdbAccessTokenInput) tmdbAccessTokenInput.value = cfg.tmdb_access_token   ?? '';
    if (tmdbKeyInput) tmdbKeyInput.value        = cfg.tmdb_api_key         ?? '';
  } catch {
    // Not in Tauri or file doesn't exist yet
  }

  if (igdbSaveBtn) igdbSaveBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({
        ...cfg,
        igdb_client_id:     clientIdInput?.value.trim() || undefined,
        igdb_client_secret: clientSecretInput?.value.trim() || undefined,
      });
      showToast('Claves de IGDB guardadas');
    } catch (err: any) {
      showToast('Error: ' + (err?.message ?? String(err)).slice(0, 60));
    }
  });

  if (igdbClearBtn) igdbClearBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({ ...cfg, igdb_client_id: undefined, igdb_client_secret: undefined });
      if (clientIdInput) clientIdInput.value = '';
      if (clientSecretInput) clientSecretInput.value = '';
      showToast('Claves de IGDB eliminadas');
    } catch {
      showToast('Error al eliminar');
    }
  });

  if (steamSaveBtn) steamSaveBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({ ...cfg, steam_api_key: steamKeyInput?.value.trim() || undefined });
      showToast('Clave de Steam guardada');
    } catch (err: any) {
      showToast('Error: ' + (err?.message ?? String(err)).slice(0, 60));
    }
  });

  if (steamClearBtn) steamClearBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({ ...cfg, steam_api_key: undefined });
      if (steamKeyInput) steamKeyInput.value = '';
      showToast('Clave de Steam eliminada');
    } catch {
      showToast('Error al eliminar');
    }
  });

  if (tmdbSaveBtn) tmdbSaveBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({
        ...cfg,
        tmdb_access_token: tmdbAccessTokenInput?.value.trim() || undefined,
        tmdb_api_key: tmdbKeyInput?.value.trim() || undefined
      });
      showToast('Credenciales de TMDB guardadas');
    } catch (err: any) {
      showToast('Error: ' + (err?.message ?? String(err)).slice(0, 60));
    }
  });

  if (tmdbClearBtn) tmdbClearBtn.addEventListener('click', async () => {
    try {
      const cfg = await readEnvConfig().catch(() => ({}));
      await writeEnvConfig({ ...cfg, tmdb_access_token: undefined, tmdb_api_key: undefined });
      if (tmdbAccessTokenInput) tmdbAccessTokenInput.value = '';
      if (tmdbKeyInput) tmdbKeyInput.value = '';
      showToast('Credenciales de TMDB eliminadas');
    } catch {
      showToast('Error al eliminar');
    }
  });

  if (openFolderBtn) openFolderBtn.addEventListener('click', async () => {
    try {
      await openEnvFolder();
      showToast('Carpeta abierta');
    } catch (err: any) {
      showToast('Error: ' + (err?.message ?? String(err)).slice(0, 60));
    }
  });
}
