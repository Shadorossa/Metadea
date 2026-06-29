import { invoke } from '@tauri-apps/api/core';

export function initAniListAuth() {
  const anilistLoginBtn = document.getElementById('anilist-login-btn') as HTMLButtonElement | null;
  const anilistUserStatus = document.getElementById('anilist-user-status');
  const anilistAvatarContainer = document.getElementById('anilist-avatar-container');
  const anilistTokenModal = document.getElementById('anilist-token-modal');
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

  // Load existing token
  invoke<string | null>('get_anilist_token').then(cachedToken => {
    if (cachedToken) {
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
          showDisconnected();
        }
      }).catch(() => {
        invoke('delete_anilist_token').catch(console.error);
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
      const token = await invoke<string | null>('get_anilist_token').catch(() => null);
      if (token) {
        // Logout
        await invoke('delete_anilist_token').catch(console.error);
        showDisconnected();
        return;
      }

      // Show token input modal
      if (anilistTokenModal) {
        anilistTokenModal.style.display = 'flex';
        // Auto open authorization link
        window.open('https://anilist.co/api/v2/oauth/authorize?client_id=18343&response_type=token', '_blank');
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
          anilistSaveTokenBtn.textContent = 'Validando y guardar';
        }
      } catch (err) {
        console.error(err);
        alert('Error al validar el token de AniList.');
        anilistSaveTokenBtn.disabled = false;
        anilistSaveTokenBtn.textContent = 'Validando y guardar';
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
