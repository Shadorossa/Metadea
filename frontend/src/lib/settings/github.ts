import { invoke } from '@tauri-apps/api/core';

export function initGitHubAuth() {
  const githubLoginBtn = document.getElementById('github-login-btn') as HTMLButtonElement | null;
  const githubUserStatus = document.getElementById('github-user-status');
  const githubAvatarContainer = document.getElementById('github-avatar-container');
  const githubDeviceModal = document.getElementById('github-device-modal');
  const githubDeviceCodeBox = document.getElementById('github-device-code-box');
  const githubCancelDeviceBtn = document.getElementById('github-cancel-device-btn');

  const GITHUB_CLIENT_ID = 'Ov23liifxqfIDxkzVfH3'; // Shadorossa's Client ID for Metadea
  let pollInterval: any = null;

  async function fetchGitHubUser(token: string) {
    return invoke<any>('get_github_user_profile', { token });
  }

  function showDisconnected() {
    if (githubUserStatus) githubUserStatus.textContent = 'No conectado';
    if (githubLoginBtn) {
      githubLoginBtn.textContent = 'Conectar';
      githubLoginBtn.className = 'btn btn--sm btn--primary';
      githubLoginBtn.disabled = false;
    }
    if (githubAvatarContainer) {
      githubAvatarContainer.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>`;
    }
  }

  // Check cached token on load via Rust filesystem session.json
  invoke<string | null>('get_github_token').then(cachedToken => {
    if (cachedToken) {
      if (githubLoginBtn) {
        githubLoginBtn.disabled = true;
        githubLoginBtn.textContent = 'Verificando...';
      }
      fetchGitHubUser(cachedToken).then(user => {
        if (githubUserStatus) githubUserStatus.textContent = `@${user.login}`;
        if (githubLoginBtn) {
          githubLoginBtn.textContent = 'Desconectar';
          githubLoginBtn.className = 'btn btn--sm btn--ghost';
          githubLoginBtn.disabled = false;
        }
        if (githubAvatarContainer && user.avatar_url) {
          githubAvatarContainer.innerHTML = `<img src="${user.avatar_url}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />`;
        }
      }).catch(async () => {
        await invoke('delete_github_token').catch(console.error);
        showDisconnected();
      });
    } else {
      showDisconnected();
    }
  }).catch(() => {
    showDisconnected();
  });

  if (githubLoginBtn) {
    githubLoginBtn.addEventListener('click', async () => {
      const token = await invoke<string | null>('get_github_token').catch(() => null);
      if (token) {
        // Log out
        await invoke('delete_github_token').catch(console.error);
        showDisconnected();
        return;
      }

      // Start device code flow
      githubLoginBtn.disabled = true;
      githubLoginBtn.textContent = 'Iniciando...';

      try {
        const data = await invoke<any>('request_github_device_code', { clientId: GITHUB_CLIENT_ID });

        if (githubDeviceCodeBox) githubDeviceCodeBox.textContent = data.user_code;
        if (githubDeviceModal) githubDeviceModal.style.display = 'flex';

        // Open browser
        window.open('https://github.com/login/device', '_blank');

        let currentInterval = (data.interval || 5) * 1000;

        async function poll() {
          try {
            const tokenData = await invoke<any>('request_github_device_token', {
              clientId: GITHUB_CLIENT_ID,
              deviceCode: data.device_code
            });

            if (tokenData.access_token) {
              if (githubDeviceModal) githubDeviceModal.style.display = 'none';
              await invoke('save_github_token', { token: tokenData.access_token }).catch(console.error);
              
              // Load user details
              const user = await fetchGitHubUser(tokenData.access_token);
              if (githubUserStatus) githubUserStatus.textContent = `@${user.login}`;
              if (githubLoginBtn) {
                githubLoginBtn.textContent = 'Desconectar';
                githubLoginBtn.className = 'btn btn--sm btn--ghost';
                githubLoginBtn.disabled = false;
              }
              if (githubAvatarContainer && user.avatar_url) {
                githubAvatarContainer.innerHTML = `<img src="${user.avatar_url}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />`;
              }
              return; // Stop polling
            }

            if (tokenData.error === 'authorization_pending') {
              // Keep waiting
            } else if (tokenData.error === 'slow_down') {
              currentInterval += 5000; // Increase polling interval
            } else {
              if (githubDeviceModal) githubDeviceModal.style.display = 'none';
              if (githubLoginBtn) {
                githubLoginBtn.disabled = false;
                githubLoginBtn.textContent = 'Conectar';
                githubLoginBtn.className = 'btn btn--sm btn--primary';
              }
              alert('Fallo en el inicio de sesión: ' + (tokenData.error_description || tokenData.error));
              return; // Stop polling
            }
          } catch (e) {
            console.error(e);
          }

          pollInterval = setTimeout(poll, currentInterval);
        }

        pollInterval = setTimeout(poll, currentInterval);

      } catch (err) {
        console.error(err);
        githubLoginBtn.disabled = false;
        githubLoginBtn.textContent = 'Conectar';
        githubLoginBtn.className = 'btn btn--sm btn--primary';
        alert('No se pudo iniciar el flujo de autenticación.');
      }
    });
  }

  if (githubCancelDeviceBtn) {
    githubCancelDeviceBtn.addEventListener('click', () => {
      if (pollInterval) clearTimeout(pollInterval);
      if (githubDeviceModal) githubDeviceModal.style.display = 'none';
      if (githubLoginBtn) {
        githubLoginBtn.disabled = false;
        githubLoginBtn.textContent = 'Conectar';
        githubLoginBtn.className = 'btn btn--sm btn--primary';
      }
    });
  }
}
