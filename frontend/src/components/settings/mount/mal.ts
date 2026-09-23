// Settings → Conexiones: the MyAnimeList block. Connect opens MAL's
// authorization page in the system browser; MAL sends the browser back to
// `metadea://auth/mal`, Rust exchanges the code (src-tauri/src/mal) and
// emits `mal://auth-result`. While the modal is open it also polls the
// status, so a result that lands before this page's listener is up (the
// deep link navigates to Settings itself) is still picked up. The paste
// field is the fallback for a browser that never comes back.
import {
  malStatus, malBeginLogin, malCompleteLogin, malGetProfile, malLogout,
  MAL_AUTH_RESULT_EVENT, type MalAuthResult,
} from '../../../lib/tauri/mal';
import { openExternalUrl } from '../../../lib/tauri/game-launch';
import { isTauri } from '../../../lib/tauri/bridge';
import { importMalList } from '../../../lib/mal/import';
import { parseDeepLinkTarget } from '../../../lib/deep-link/deep-link-routes';
import type { ImportProgress } from '../../../lib/anilist/import';
import { formatAppError } from '../../../lib/errors/format-error';
import { setAuthButtonBusy } from './auth-button';
import { showAuthConnected, showAuthDisconnected } from './auth-status';
import { showModal, hideModal } from '../../../lib/dom/modal-utils';
import { byId } from '../../../lib/dom/dom';
import { escapeHtml } from '../../../lib/shared/text/sanitize-html';
import { getT } from '../../../i18n/runtime';
import { showToast } from '../../../lib/dom/toast';

const DISCONNECTED_AVATAR_HTML = '<img src="/API/MyAnimeList_logo.svg" style="width: 18px; height: 18px;" />';
const STATUS_POLL_MS = 1500;
const STATUS_POLL_MAX_MS = 3 * 60 * 1000;

/** `metadea://auth/mal?code=…&state=…` pasted by hand → its code/state. */
export function parsePastedAuthUrl(raw: string): { code: string; state: string } | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'metadea:' || `${url.host}${url.pathname}`.replace(/\/$/, '') !== 'auth/mal') return null;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) return null;
  const target = parseDeepLinkTarget({ kind: 'auth_mal', code, state });
  return target?.kind === 'auth_mal' ? { code: target.code, state: target.state } : null;
}

export function initMal(showSettingsToast: (msg?: string) => void) {
  const loginBtn = byId<HTMLButtonElement>('mal-login-btn');
  if (!loginBtn) return;
  const t = getT().mal;
  const statusEls = {
    loginBtn,
    statusEl: document.getElementById('mal-user-status'),
    avatarEl: document.getElementById('mal-avatar-container'),
  };
  const importBtn = byId<HTMLButtonElement>('mal-import-btn');
  const loginModal = byId<HTMLElement>('mal-login-modal');
  const openAgainBtn = byId<HTMLButtonElement>('mal-open-auth-btn');
  const pasteInput = byId<HTMLInputElement>('mal-redirect-input');
  const pasteBtn = byId<HTMLButtonElement>('mal-complete-btn');
  const cancelBtn = byId<HTMLButtonElement>('mal-cancel-btn');

  let authorizeUrl: string | null = null;
  let pollTimer: number | null = null;
  let pollUntil = 0;

  function stopPolling() {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function closeLoginModal() {
    stopPolling();
    hideModal(loginModal);
    if (pasteInput) pasteInput.value = '';
  }

  function showDisconnected() {
    showAuthDisconnected(statusEls, DISCONNECTED_AVATAR_HTML);
    if (importBtn) importBtn.disabled = true;
  }

  async function refreshStatus(): Promise<boolean> {
    const status = await malStatus().catch(() => null);
    if (!status?.connected) {
      showDisconnected();
      return false;
    }
    setAuthButtonBusy(loginBtn, t.verifying);
    try {
      const profile = await malGetProfile();
      showAuthConnected(statusEls, profile.name, profile.picture ?? undefined);
      if (importBtn) importBtn.disabled = false;
    } catch (err) {
      // Still connected as far as storage goes (a network blip, say); the
      // token is only dropped by Rust when MAL itself refuses the refresh.
      const stillConnected = (await malStatus().catch(() => null))?.connected ?? false;
      if (stillConnected) {
        showAuthConnected(statusEls, 'MyAnimeList');
        if (importBtn) importBtn.disabled = false;
        showToast(formatAppError(err, getT()), 'error');
      } else {
        showToast(formatAppError(err, getT()), 'error');
        showDisconnected();
      }
    }
    return true;
  }

  function onAuthResult(result: MalAuthResult) {
    closeLoginModal();
    if (result.ok) {
      showSettingsToast(t.connected_toast);
      void refreshStatus();
    } else {
      showToast(t.login_failed.replace('{message}', formatAppError(result.error ?? '', getT())), 'error');
      void refreshStatus();
    }
  }

  function pollWhileWaiting() {
    stopPolling();
    if (Date.now() > pollUntil) return;
    pollTimer = window.setTimeout(async () => {
      const status = await malStatus().catch(() => null);
      if (status?.connected) onAuthResult({ ok: true, error: null });
      else pollWhileWaiting();
    }, STATUS_POLL_MS);
  }

  async function beginLogin() {
    const status = await malStatus().catch(() => null);
    if (!status?.client_id_configured) {
      showToast(t.client_id_required, 'error');
      return;
    }
    try {
      authorizeUrl = await malBeginLogin();
    } catch (err) {
      showToast(formatAppError(err, getT()), 'error');
      return;
    }
    showModal(loginModal);
    pollUntil = Date.now() + STATUS_POLL_MAX_MS;
    pollWhileWaiting();
    await openExternalUrl(authorizeUrl).catch(() => window.open(authorizeUrl ?? '', '_blank'));
  }

  loginBtn.addEventListener('click', async () => {
    const status = await malStatus().catch(() => null);
    if (status?.connected) {
      await malLogout().catch(err => showToast(formatAppError(err, getT()), 'error'));
      showDisconnected();
      return;
    }
    await beginLogin();
  });

  openAgainBtn?.addEventListener('click', () => {
    if (authorizeUrl) void openExternalUrl(authorizeUrl).catch(() => window.open(authorizeUrl ?? '', '_blank'));
  });

  pasteBtn?.addEventListener('click', async () => {
    const parsed = parsePastedAuthUrl(pasteInput?.value ?? '');
    if (!parsed) {
      showToast(t.login_fallback_invalid, 'error');
      return;
    }
    setAuthButtonBusy(pasteBtn, t.verifying);
    try {
      await malCompleteLogin(parsed.code, parsed.state);
      // The event handler closes the modal and refreshes; nothing else to do.
    } catch (err) {
      showToast(t.login_failed.replace('{message}', formatAppError(err, getT())), 'error');
    } finally {
      pasteBtn.disabled = false;
      pasteBtn.textContent = t.login_fallback_submit;
    }
  });

  cancelBtn?.addEventListener('click', closeLoginModal);

  if (isTauri()) {
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        await listen<MalAuthResult>(MAL_AUTH_RESULT_EVENT, event => onAuthResult(event.payload));
      } catch (err) {
        console.warn('[MAL] Could not subscribe to auth results:', err);
      }
    })();
  }

  initMalImport(importBtn, showSettingsToast);
  void refreshStatus();
}

// ── Import ────────────────────────────────────────────────────────────────────

function createProgressModal(title: string) {
  const t = getT();
  const modal = document.createElement('div');
  modal.id = 'mal-import-progress-modal';
  modal.className = 'settings-progress-modal';
  modal.innerHTML = `
    <h3 class="settings-progress-modal-title">${escapeHtml(title)}</h3>
    <div class="settings-progress-box">
      <div class="settings-progress-status" id="mal-import-status">${escapeHtml(t.settings.github_starting)}</div>
      <div class="settings-progress-track">
        <div id="mal-import-progress" class="settings-progress-fill" style="width: 0%;"></div>
      </div>
      <div class="settings-progress-count" id="mal-import-count">0/0</div>
    </div>
  `;
  const backdrop = document.createElement('div');
  backdrop.id = 'mal-import-progress-backdrop';
  backdrop.className = 'settings-modal-backdrop';
  document.body.appendChild(backdrop);
  document.body.appendChild(modal);
  return { modal, backdrop };
}

function updateProgressUI(progress: ImportProgress) {
  const statusEl = document.getElementById('mal-import-status');
  const progressEl = document.getElementById('mal-import-progress');
  const countEl = document.getElementById('mal-import-count');
  if (statusEl) statusEl.textContent = progress.message || progress.status;
  if (progressEl && progress.total > 0) progressEl.style.width = `${(progress.current / progress.total) * 100}%`;
  if (countEl) countEl.textContent = `${progress.current}/${progress.total}`;
}

function initMalImport(importBtn: HTMLButtonElement | null, showSettingsToast: (msg?: string) => void) {
  if (!importBtn) return;
  let running = false;
  importBtn.addEventListener('click', async () => {
    if (running) return;
    running = true;
    const t = getT().mal;
    const { modal, backdrop } = createProgressModal(t.import_title);
    try {
      const result = await importMalList(['anime', 'manga'], updateProgressUI);
      if (!result.ok) {
        showToast(getT().settings.error_with_message.replace('{message}', formatAppError(result.error ?? '', getT())), 'error');
        return;
      }
      const unmatched = result.unmatched ?? [];
      const summary = (unmatched.length ? t.import_result_unmatched : t.import_result)
        .replace('{updated}', String(result.updated ?? 0))
        .replace('{added}', String(result.added ?? 0))
        .replace('{unmatched}', String(unmatched.length));
      showSettingsToast(summary);
      if (unmatched.length) {
        console.warn(`[MAL] ${t.import_unmatched_title}`, unmatched.map(row => `${row.mal_id} ${row.title}`));
      }
      if (result.failed) {
        showToast(getT().settings.anilist_import_partial
          .replace('{done}', String((result.updated ?? 0) + (result.added ?? 0)))
          .replace('{total}', String((result.updated ?? 0) + (result.added ?? 0) + result.failed))
          .replace('{failed}', String(result.failed)), 'error');
      }
    } catch (err) {
      showToast(getT().settings.error_with_message.replace('{message}', formatAppError(err, getT())), 'error');
    } finally {
      modal.remove();
      backdrop.remove();
      running = false;
    }
  });
}
