// Shared connected/disconnected UI rendering for OAuth-style auth flows
// (GitHub device code, AniList token paste). The actual auth mechanics differ
// per provider — only the "how do we show the result" shape is identical.
import { setAuthButtonState } from './auth-button';

export interface AuthStatusEls {
  loginBtn:  HTMLButtonElement | null;
  statusEl:  HTMLElement | null;
  avatarEl:  HTMLElement | null;
}

export function showAuthDisconnected(els: AuthStatusEls, disconnectedAvatarHtml: string) {
  if (els.statusEl) els.statusEl.textContent = 'No conectado';
  setAuthButtonState(els.loginBtn, 'disconnected');
  if (els.avatarEl) els.avatarEl.innerHTML = disconnectedAvatarHtml;
}

export function showAuthConnected(els: AuthStatusEls, username: string, avatarUrl?: string) {
  if (els.statusEl) els.statusEl.textContent = `@${username}`;
  setAuthButtonState(els.loginBtn, 'connected');
  if (els.avatarEl && avatarUrl) {
    els.avatarEl.innerHTML = `<img src="${avatarUrl}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;" />`;
  }
}
