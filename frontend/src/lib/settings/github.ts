import { invoke } from '@tauri-apps/api/core';
import { ICON_GITHUB } from '../shared/icon-strings';
import { setAuthButtonBusy } from '../shared/auth-button';
import { showAuthConnected, showAuthDisconnected } from '../shared/auth-status';
import { showModal, hideModal } from '../shared/modal-utils';
import { byId } from '../shared/dom';
import { getT } from '../../i18n/client';
import { API_ENDPOINTS } from '../api/endpoints';

export function initGitHubAuth() {
  const t = getT().settings;
  const githubLoginBtn = byId<HTMLButtonElement>('github-login-btn');
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

  const statusEls = { loginBtn: githubLoginBtn, statusEl: githubUserStatus, avatarEl: githubAvatarContainer };

  function showDisconnected() {
    showAuthDisconnected(statusEls, ICON_GITHUB);
  }

  function showConnected(login: string, avatarUrl?: string) {
    showAuthConnected(statusEls, login, avatarUrl);
  }

  // Check cached token on load via Rust filesystem session.json
  invoke<string | null>('get_github_token').then(cachedToken => {
    if (cachedToken) {
      setAuthButtonBusy(githubLoginBtn, t.github_verifying);
      fetchGitHubUser(cachedToken).then(user => {
        showConnected(user.login, user.avatar_url);
      }).catch(async err => {
        // Could be an expired/revoked token, but could just as easily be a
        // network blip — log it so a real failure doesn't look identical to
        // "token was fine, just logged out" with zero trace.
        console.error('GitHub token validation failed:', err);
        await invoke('delete_github_token').catch(console.error);
        showDisconnected();
      });
    } else {
      showDisconnected();
    }
  }).catch(err => {
    console.error('GitHub cached-token lookup failed:', err);
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
      setAuthButtonBusy(githubLoginBtn, t.github_starting);

      try {
        const data = await invoke<any>('request_github_device_code', { clientId: GITHUB_CLIENT_ID });

        if (githubDeviceCodeBox) githubDeviceCodeBox.textContent = data.user_code;
        showModal(githubDeviceModal);

        // Open browser
        window.open(API_ENDPOINTS.GITHUB_DEVICE_LOGIN, '_blank');

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
              alert(t.github_login_failed.replace('{error}', tokenData.error_description || tokenData.error));
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
        alert(t.github_auth_flow_error);
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
