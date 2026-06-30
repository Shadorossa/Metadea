import { invoke } from '@tauri-apps/api/core';
import { readEnvConfig } from '../tauri';

export function initAniListAuth() {
  const anilistLoginBtn = document.getElementById('anilist-login-btn') as HTMLButtonElement | null;
  const anilistUserStatus = document.getElementById('anilist-user-status');
  const anilistAvatarContainer = document.getElementById('anilist-avatar-container');
  const anilistTokenModal = document.getElementById('anilist-token-modal');
  const anilistAuthLink = document.getElementById('anilist-auth-link') as HTMLAnchorElement | null;
  const anilistTokenInput = document.getElementById('anilist-token-input') as HTMLInputElement | null;
  const anilistSaveTokenBtn = document.getElementById('anilist-save-token-btn');
  const anilistCancelTokenBtn = document.getElementById('anilist-cancel-token-btn');

  async function fetchAniListUser(token: string) {
    return invoke<any>('get_anilist_user_profile', { token });
  }

  function showDisconnected() {
    if (anilistUserStatus) anilistUserStatus.textContent = 'No conectado';
    if (anilistLoginBtn) {
      anilistLoginBtn.textContent = 'Conectar';
      anilistLoginBtn.className = 'btn btn--sm btn--primary';
      anilistLoginBtn.disabled = false;
    }
    if (anilistAvatarContainer) {
      anilistAvatarContainer.innerHTML = `<img src="/API/Anilist_logo.png" style="width: 18px; height: 18px;" />`;
    }
    if (anilistTokenInput) anilistTokenInput.value = '';
  }

  // Load existing token from both sources
  const lsToken = typeof localStorage !== 'undefined' ? localStorage.getItem('metadea_anilist_token') : null;
  const tokenPromise = lsToken
    ? Promise.resolve(lsToken)
    : invoke<string | null>('get_anilist_token').catch(() => null);

  tokenPromise.then(cachedToken => {
    if (cachedToken) {
      // Sync to localStorage if loaded from Tauri
      if (typeof localStorage !== 'undefined' && !lsToken) {
        localStorage.setItem('metadea_anilist_token', cachedToken);
      }
      if (anilistLoginBtn) {
        anilistLoginBtn.disabled = true;
        anilistLoginBtn.textContent = 'Verificando...';
      }
      fetchAniListUser(cachedToken).then(res => {
        const user = res?.data?.Viewer;
        if (user) {
          if (anilistUserStatus) anilistUserStatus.textContent = `@${user.name}`;
          if (anilistLoginBtn) {
            anilistLoginBtn.textContent = 'Desconectar';
            anilistLoginBtn.className = 'btn btn--sm btn--ghost';
            anilistLoginBtn.disabled = false;
          }
          if (anilistAvatarContainer && user.avatar?.large) {
            anilistAvatarContainer.innerHTML = `<img src="${user.avatar.large}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />`;
          }
        } else {
          invoke('delete_anilist_token').catch(console.error);
          if (typeof localStorage !== 'undefined') {
            localStorage.removeItem('metadea_anilist_token');
          }
          showDisconnected();
        }
      }).catch(() => {
        invoke('delete_anilist_token').catch(console.error);
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('metadea_anilist_token');
        }
        showDisconnected();
      });
    } else {
      showDisconnected();
    }
  }).catch(() => {
    showDisconnected();
  });

  if (anilistLoginBtn) {
    anilistLoginBtn.addEventListener('click', async () => {
      const token = await invoke<string | null>('get_get_github_token').catch(() => null); // Check session
      const lsToken = typeof localStorage !== 'undefined' ? localStorage.getItem('metadea_anilist_token') : null;
      const cachedToken = lsToken || (await invoke<string | null>('get_anilist_token').catch(() => null));
      if (cachedToken) {
        // Logout
        await invoke('delete_anilist_token').catch(console.error);
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem('metadea_anilist_token');
        }
        showDisconnected();
        return;
      }

      // Read Client ID from Environment Config
      try {
        const envConfig = await readEnvConfig();
        const clientId = envConfig.anilist_client_id?.trim();

        if (!clientId) {
          alert('Por favor, configura tu AniList Client ID en la pestaña Entorno (Ajustes de Aplicación) antes de conectar.');
          return;
        }

        const authUrl = `https://anilist.co/api/v2/oauth/authorize?client_id=${clientId}&response_type=token`;

        if (anilistAuthLink) {
          anilistAuthLink.href = authUrl;
        }

        // Show token input modal
        if (anilistTokenModal) {
          anilistTokenModal.style.display = 'flex';
          // Auto open authorization link
          window.open(authUrl, '_blank');
        }

      } catch (err) {
        console.error(err);
        alert('Error al leer la configuración de entorno.');
      }
    });
  }

  if (anilistSaveTokenBtn && anilistTokenInput) {
    anilistSaveTokenBtn.addEventListener('click', async () => {
      const rawToken = anilistTokenInput.value.trim();
      if (!rawToken) {
        alert('Por favor, introduce un token válido.');
        return;
      }

      anilistSaveTokenBtn.disabled = true;
      anilistSaveTokenBtn.textContent = 'Validando...';

      try {
        const res = await fetchAniListUser(rawToken);
        const user = res?.data?.Viewer;

        if (user) {
          await invoke('save_anilist_token', { token: rawToken });
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem('metadea_anilist_token', rawToken);
          }
          if (anilistTokenModal) anilistTokenModal.style.display = 'none';

          if (anilistUserStatus) anilistUserStatus.textContent = `@${user.name}`;
          if (anilistLoginBtn) {
            anilistLoginBtn.textContent = 'Desconectar';
            anilistLoginBtn.className = 'btn btn--sm btn--ghost';
            anilistLoginBtn.disabled = false;
          }
          if (anilistAvatarContainer && user.avatar?.large) {
            anilistAvatarContainer.innerHTML = `<img src="${user.avatar.large}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />`;
          }
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

  if (anilistCancelTokenBtn) {
    anilistCancelTokenBtn.addEventListener('click', () => {
      if (anilistTokenModal) anilistTokenModal.style.display = 'none';
      if (anilistTokenInput) anilistTokenInput.value = '';
      if (anilistSaveTokenBtn) {
        anilistSaveTokenBtn.disabled = false;
        anilistSaveTokenBtn.textContent = 'Validar y guardar';
      }
    });
  }
}
