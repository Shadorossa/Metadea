import { invoke } from '@tauri-apps/api/core';
import { readEnvConfig } from '../tauri';
import { STORAGE_KEYS } from '../shared/storage-keys';
import { setAuthButtonState, setAuthButtonBusy } from '../shared/auth-button';
import { showModal, hideModal } from '../shared/modal-utils';

const ls = {
  get: (key: string) => localStorage.getItem(key),
  set: (key: string, val: string) => localStorage.setItem(key, val),
  del: (key: string) => localStorage.removeItem(key),
};

const TOKEN_KEY = STORAGE_KEYS.anilistToken;

export function initAniListAuth() {
  const anilistLoginBtn     = document.getElementById('anilist-login-btn') as HTMLButtonElement | null;
  const anilistUserStatus   = document.getElementById('anilist-user-status');
  const anilistAvatarContainer = document.getElementById('anilist-avatar-container');
  const anilistTokenModal   = document.getElementById('anilist-token-modal');
  const anilistAuthLink     = document.getElementById('anilist-auth-link') as HTMLAnchorElement | null;
  const anilistTokenInput   = document.getElementById('anilist-token-input') as HTMLInputElement | null;
  const anilistSaveTokenBtn = document.getElementById('anilist-save-token-btn') as HTMLButtonElement | null;
  const anilistCancelTokenBtn = document.getElementById('anilist-cancel-token-btn');

  async function fetchAniListUser(token: string) {
    return invoke<any>('get_anilist_user_profile', { token });
  }

  function showDisconnected() {
    if (anilistUserStatus) anilistUserStatus.textContent = 'No conectado';
    setAuthButtonState(anilistLoginBtn, 'disconnected');
    if (anilistAvatarContainer) {
      anilistAvatarContainer.innerHTML = `<img src="/API/Anilist_logo.png" style="width: 18px; height: 18px;" />`;
    }
    if (anilistTokenInput) anilistTokenInput.value = '';
  }

  function showConnected(name: string, avatarUrl?: string) {
    if (anilistUserStatus) anilistUserStatus.textContent = `@${name}`;
    setAuthButtonState(anilistLoginBtn, 'connected');
    if (anilistAvatarContainer && avatarUrl) {
      anilistAvatarContainer.innerHTML = `<img src="${avatarUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />`;
    }
  }

  function clearToken() {
    invoke('delete_anilist_token').catch(console.error);
    ls.del(TOKEN_KEY);
  }

  // localStorage is the source of truth; fall back to Tauri once for migration
  const lsToken = ls.get(TOKEN_KEY);
  const tokenPromise = lsToken
    ? Promise.resolve(lsToken)
    : invoke<string | null>('get_anilist_token').catch(() => null);

  tokenPromise.then(cachedToken => {
    if (!cachedToken) { showDisconnected(); return; }

    // Migrate from Tauri-only storage to localStorage
    if (!lsToken) ls.set(TOKEN_KEY, cachedToken);

    setAuthButtonBusy(anilistLoginBtn, 'Verificando...');

    fetchAniListUser(cachedToken).then(res => {
      const user = res?.data?.Viewer;
      if (user) {
        showConnected(user.name, user.avatar?.large);
      } else {
        clearToken();
        showDisconnected();
      }
    }).catch(() => {
      clearToken();
      showDisconnected();
    });
  }).catch(() => {
    showDisconnected();
  });

  anilistLoginBtn?.addEventListener('click', async () => {
    const cachedToken = ls.get(TOKEN_KEY) || (await invoke<string | null>('get_anilist_token').catch(() => null));
    if (cachedToken) {
      clearToken();
      showDisconnected();
      return;
    }

    try {
      const envConfig = await readEnvConfig();
      const clientId = envConfig.anilist_client_id?.trim();
      if (!clientId) {
        alert('Por favor, configura tu AniList Client ID en la pestaña Entorno (Ajustes de Aplicación) antes de conectar.');
        return;
      }

      const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token`;
      if (anilistAuthLink) anilistAuthLink.href = authUrl;
      if (anilistTokenModal) {
        showModal(anilistTokenModal);
        window.open(authUrl, '_blank');
      }
    } catch (err) {
      console.error(err);
      alert('Error al leer la configuración de entorno.');
    }
  });

  if (anilistSaveTokenBtn && anilistTokenInput) {
    anilistSaveTokenBtn.addEventListener('click', async () => {
      const rawToken = anilistTokenInput.value.trim();
      if (!rawToken) { alert('Por favor, introduce un token válido.'); return; }

      setAuthButtonBusy(anilistSaveTokenBtn, 'Validando...');

      try {
        const res = await fetchAniListUser(rawToken);
        const user = res?.data?.Viewer;

        if (user) {
          await invoke('save_anilist_token', { token: rawToken });
          ls.set(TOKEN_KEY, rawToken);
          hideModal(anilistTokenModal);
          showConnected(user.name, user.avatar?.large);
        } else {
          alert('Token no válido o expirado.');
          anilistSaveTokenBtn.disabled = false;
          anilistSaveTokenBtn.textContent = 'Validar y guardar';
        }
      } catch (err) {
        console.error(err);
        alert('Error al validar el token de AniList.');
        anilistSaveTokenBtn.disabled = false;
        anilistSaveTokenBtn.textContent = 'Validar y guardar';
      }
    });
  }

  anilistCancelTokenBtn?.addEventListener('click', () => {
    hideModal(anilistTokenModal);
    if (anilistTokenInput) anilistTokenInput.value = '';
    if (anilistSaveTokenBtn) {
      anilistSaveTokenBtn.disabled = false;
      anilistSaveTokenBtn.textContent = 'Validar y guardar';
    }
  });
}
