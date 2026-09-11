import { invoke, readEnvConfig } from '../tauri';
import { STORAGE_KEYS } from '../shared/storage-keys';
import { setAuthButtonBusy } from './auth-button';
import { showAuthConnected, showAuthDisconnected } from './auth-status';
import { showModal, hideModal } from '../shared/modal-utils';
import { byId } from '../shared/dom';
import { getT } from '../../i18n/client';

const DISCONNECTED_AVATAR_HTML = `<img src="/API/Anilist_logo.png" style="width: 18px; height: 18px;" />`;

const ls = {
  get: (key: string) => localStorage.getItem(key),
  set: (key: string, val: string) => localStorage.setItem(key, val),
  del: (key: string) => localStorage.removeItem(key),
};

const TOKEN_KEY = STORAGE_KEYS.anilistToken;

function showToast(message: string, type: 'error' | 'success' = 'success') {
  try {
    const toast = document.createElement('div');
    const bgColor = type === 'error' ? '#ef4444' : '#10b981';
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${bgColor};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      animation: slideUp 0.3s ease-out;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
  } catch (e) {
    console.warn('Failed to show toast:', e);
  }
}

export function initAniListAuth() {
  const t = getT().settings;
  const anilistLoginBtn     = byId<HTMLButtonElement>('anilist-login-btn');
  const anilistUserStatus   = document.getElementById('anilist-user-status');
  const anilistAvatarContainer = document.getElementById('anilist-avatar-container');
  const anilistTokenModal   = document.getElementById('anilist-token-modal');
  const anilistAuthLink     = byId<HTMLAnchorElement>('anilist-auth-link');
  const anilistTokenInput   = byId<HTMLInputElement>('anilist-token-input');
  const anilistSaveTokenBtn = byId<HTMLButtonElement>('anilist-save-token-btn');
  const anilistCancelTokenBtn = document.getElementById('anilist-cancel-token-btn');

  async function fetchAniListUser(token: string) {
    return invoke<any>('get_anilist_user_profile', { token });
  }

  const statusEls = { loginBtn: anilistLoginBtn, statusEl: anilistUserStatus, avatarEl: anilistAvatarContainer };

  function showDisconnected() {
    showAuthDisconnected(statusEls, DISCONNECTED_AVATAR_HTML);
    if (anilistTokenInput) anilistTokenInput.value = '';
  }

  function showConnected(name: string, avatarUrl?: string) {
    showAuthConnected(statusEls, name, avatarUrl);
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

    setAuthButtonBusy(anilistLoginBtn, t.anilist_verifying);

    fetchAniListUser(cachedToken).then(res => {
      const user = res?.data?.Viewer;
      if (user) {
        showConnected(user.name, user.avatar?.large);
      } else {
        // Check if it's a token error
        const errors = res?.errors;
        if (errors?.some(e =>
          e.message?.includes('Unauthorized') ||
          e.message?.includes('expired') ||
          e.message?.includes('invalid')
        )) {
          console.warn('AniList token is invalid or expired, disconnecting');
          showToast(t.anilist_token_expired, 'error');
        } else if (errors?.length) {
          console.error('AniList validation error:', errors[0]?.message);
          showToast(errors[0]?.message || t.anilist_token_validate_error, 'error');
        }
        clearToken();
        showDisconnected();
      }
    }).catch(err => {
      console.error('AniList token validation failed:', err);
      showToast(t.anilist_network_error, 'error');
      clearToken();
      showDisconnected();
    });
  }).catch(err => {
    console.error('AniList cached-token lookup failed:', err);
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
        alert(t.anilist_client_id_required);
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
      alert(t.anilist_env_read_error);
    }
  });

  if (anilistSaveTokenBtn && anilistTokenInput) {
    anilistSaveTokenBtn.addEventListener('click', async () => {
      const rawToken = anilistTokenInput.value.trim();
      if (!rawToken) { alert(t.anilist_token_required); return; }

      setAuthButtonBusy(anilistSaveTokenBtn, t.anilist_validating);

      try {
        const res = await fetchAniListUser(rawToken);
        const user = res?.data?.Viewer;

        if (user) {
          await invoke('save_anilist_token', { token: rawToken });
          ls.set(TOKEN_KEY, rawToken);
          hideModal(anilistTokenModal);
          showConnected(user.name, user.avatar?.large);
          showToast(t.connect + ' ✓', 'success');
        } else {
          const errors = res?.errors;
          let errorMsg = t.anilist_token_invalid;

          if (errors?.some(e =>
            e.message?.includes('Unauthorized') ||
            e.message?.includes('expired')
          )) {
            errorMsg = t.anilist_token_expired;
          } else if (errors?.length) {
            errorMsg = errors[0]?.message || t.anilist_token_validate_error;
          }

          showToast(errorMsg, 'error');
          anilistSaveTokenBtn.disabled = false;
          anilistSaveTokenBtn.textContent = t.anilist_validate_save;
        }
      } catch (err) {
        console.error(err);
        showToast(t.anilist_network_error, 'error');
        anilistSaveTokenBtn.disabled = false;
        anilistSaveTokenBtn.textContent = t.anilist_validate_save;
      }
    });
  }

  anilistCancelTokenBtn?.addEventListener('click', () => {
    hideModal(anilistTokenModal);
    if (anilistTokenInput) anilistTokenInput.value = '';
    if (anilistSaveTokenBtn) {
      anilistSaveTokenBtn.disabled = false;
      anilistSaveTokenBtn.textContent = t.anilist_validate_save;
    }
  });
}
