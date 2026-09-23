// Shared connect/disconnect button styling for OAuth-style auth flows
// (GitHub, AniList) — keeps the three-state contract (disconnected / busy /
// connected) consistent instead of each flow re-typing the same class names.

import { getT } from '../../../i18n/runtime';

export type AuthButtonState = 'connected' | 'disconnected';

export function setAuthButtonState(btn: HTMLButtonElement | null | undefined, state: AuthButtonState) {
  if (!btn) return;
  if (state === 'connected') {
    btn.textContent = getT().settings.disconnect;
    btn.className = 'btn btn--sm btn--ghost';
  } else {
    btn.textContent = getT().settings.connect;
    btn.className = 'btn btn--sm btn--primary';
  }
  btn.disabled = false;
}

export function setAuthButtonBusy(btn: HTMLButtonElement | null | undefined, text: string) {
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = text;
}
