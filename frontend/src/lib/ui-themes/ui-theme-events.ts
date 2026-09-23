// The two window channels the UI-theme feature uses (see DEVELOPMENT_RULES
// 2.4: every CustomEvent channel is declared once, with its detail type).
// UiThemeLoader listens; the settings section and the deactivate shortcut emit.
import { STORAGE_KEYS } from '../storage/storage-keys';

/** The active theme changed (activated, deactivated, or re-selected). */
export const UI_THEME_CHANGED_EVENT = 'metadea:ui-theme-changed';
/** The "watch for changes" dev toggle flipped. */
export const UI_THEME_WATCH_CHANGED_EVENT = 'metadea:ui-theme-watch-changed';

export interface UiThemeChangedDetail {
  themeId: string | null;
}

export function emitUiThemeChanged(themeId: string | null): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<UiThemeChangedDetail>(UI_THEME_CHANGED_EVENT, { detail: { themeId } }));
}

export function onUiThemeChanged(handler: (detail: UiThemeChangedDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<UiThemeChangedDetail>).detail);
  window.addEventListener(UI_THEME_CHANGED_EVENT, listener);
  return () => window.removeEventListener(UI_THEME_CHANGED_EVENT, listener);
}

export function isUiThemeWatchEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try { return localStorage.getItem(STORAGE_KEYS.uiThemeWatch) === '1'; } catch { return false; }
}

export function setUiThemeWatchEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) localStorage.setItem(STORAGE_KEYS.uiThemeWatch, '1');
    else localStorage.removeItem(STORAGE_KEYS.uiThemeWatch);
  } catch { /* private mode: the toggle just does not persist */ }
  window.dispatchEvent(new CustomEvent(UI_THEME_WATCH_CHANGED_EVENT));
}
