import { invoke } from '@tauri-apps/api/core';
import { ICON_GITHUB } from '../shared/icon-strings';
import { setAuthButtonState, setAuthButtonBusy } from '../shared/auth-button';
import { showModal, hideModal } from '../shared/modal-utils';

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
    setAuthButtonState(githubLoginBtn, 'disconnected');
    if (githubAvatarContainer) {
      githubAvatarContainer.innerHTML = ICON_GITHUB;
    }
  }

  function showConnected(login: string, avatarUrl?: string) {
    if (githubUserStatus) githubUserStatus.textContent = `@${login}`;
    setAuthButtonState(githubLoginBtn, 'connected');
    if (githubAvatarContainer && avatarUrl) {
      githubAvatarContainer.innerHTML = `<img src="${avatarUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />`;
    }
  }

  // Check cached token on load via Rust filesystem session.json
  invoke<string | null>('get_github_token').then(cachedToken => {
    if (cachedToken) {
      setAuthButtonBusy(githubLoginBtn, 'Verificando...');
      fetchGitHubUser(cachedToken).then(user => {
        showConnected(user.login, user.avatar_url);
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
      setAuthButtonBusy(githubLoginBtn, 'Iniciando...');

      try {
        const data = await invoke<any>('request_github_device_code', { clientId: GITHUB_CLIENT_ID });

        if (githubDeviceCodeBox) githubDeviceCodeBox.textContent = data.user_code;
        showModal(githubDeviceModal);

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
              hideModal(githubDeviceModal);
              await invoke('save_github_token', { token: tokenData.access_token }).catch(console.error);

              // Load user details
              const user = await fetchGitHubUser(tokenData.access_token);
              showConnected(user.login, user.avatar_url);
              return; // Stop polling
            }

            if (tokenData.error === 'authorization_pending') {
              // Keep waiting
            } else if (tokenData.error === 'slow_down') {
              currentInterval += 5000; // Increase polling interval
            } else {
              hideModal(githubDeviceModal);
              showDisconnected();
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
        showDisconnected();
        alert('No se pudo iniciar el flujo de autenticación.');
      }
    });
  }

  if (githubCancelDeviceBtn) {
    githubCancelDeviceBtn.addEventListener('click', () => {
      if (pollInterval) clearTimeout(pollInterval);
      hideModal(githubDeviceModal);
      showDisconnected();
    });
  }
}
