// Keeps the Interface scale applied after the <head> bootstrap
// (ui-scale-bootstrap.ts): re-computes it when the window is resized, moves
// to a monitor with another DPI, or the preference changes in Settings, and
// applies it as the webview zoom — so layout, hit-testing, fixed positioning,
// drag and drop and popovers all scale together, unlike CSS `zoom`.

import { getCurrentWebview } from '@tauri-apps/api/webview';
import { STORAGE_KEYS } from '../storage/storage-keys';
import { waitForTauriBridge } from '../tauri/bridge';
import {
  computeUiScale,
  parseAppliedZoom,
  parseUiScalePreference,
  serializeUiScalePreference,
  shouldApplyUiScale,
  type UiScalePreference,
} from './ui-scale';

export type UiScaleMode = 'window' | 'follow-main';

/** Fired on window after the preference changes (Settings). */
export const UI_SCALE_CHANGE_EVENT = 'metadea:ui-scale-change';

const RESIZE_DEBOUNCE_MS = 150;

function readStorage(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: Storage, key: string, value: string): void {
  try {
    storage.setItem(key, value);
  } catch {
    /* storage unavailable: the zoom still applies, it just is not remembered */
  }
}

export function readUiScalePreference(): UiScalePreference {
  return parseUiScalePreference(readStorage(localStorage, STORAGE_KEYS.uiScale));
}

/** Stores the choice and applies it right away (no reload). */
export function writeUiScalePreference(preference: UiScalePreference): void {
  localStorage.setItem(STORAGE_KEYS.uiScale, serializeUiScalePreference(preference));
  window.dispatchEvent(new Event(UI_SCALE_CHANGE_EVENT));
}

/** Zoom currently applied to this webview (1 before any change). */
export function getAppliedUiZoom(): number {
  return parseAppliedZoom(readStorage(sessionStorage, STORAGE_KEYS.uiScaleWebviewZoom));
}

function targetZoom(mode: UiScaleMode, current: number): number {
  if (mode === 'follow-main') return parseAppliedZoom(readStorage(localStorage, STORAGE_KEYS.uiScaleMainZoom));
  return computeUiScale(readUiScalePreference(), window.innerWidth * current);
}

async function syncZoom(mode: UiScaleMode): Promise<void> {
  const current = getAppliedUiZoom();
  const target = targetZoom(mode, current);
  let applied = current;
  if (shouldApplyUiScale(current, target)) {
    await getCurrentWebview().setZoom(target);
    applied = target;
    writeStorage(sessionStorage, STORAGE_KEYS.uiScaleWebviewZoom, String(applied));
  }
  // The player overlay follows the main window's zoom.
  if (mode === 'window') writeStorage(localStorage, STORAGE_KEYS.uiScaleMainZoom, String(applied));
}

let registered = false;

/**
 * Applies the Interface scale now and whenever it has to change. Idempotent
 * (safe to call from a script that re-runs after page swaps). No-op outside
 * Tauri.
 */
export function registerUiScale(mode: UiScaleMode): void {
  if (registered || typeof window === 'undefined') return;
  registered = true;

  // One sync at a time; a request made meanwhile runs once afterwards.
  let running: Promise<void> | null = null;
  let pending = false;
  const sync = () => {
    if (running) {
      pending = true;
      return;
    }
    running = syncZoom(mode)
      .catch(err => console.warn('[UiScale] Could not apply the interface scale:', err))
      .finally(() => {
        running = null;
        if (pending) {
          pending = false;
          sync();
        }
      });
  };

  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleSync = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(sync, RESIZE_DEBOUNCE_MS);
  };

  // A media query that stops matching exactly when devicePixelRatio changes
  // (another monitor's DPI, or our own zoom); re-armed for the new ratio.
  let dprQuery: MediaQueryList | null = null;
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener('change', onDprChange);
  };
  function onDprChange() {
    watchDpr();
    scheduleSync();
  }

  void waitForTauriBridge().then(ready => {
    if (!ready) return;
    sync();
    window.addEventListener('resize', scheduleSync);
    window.addEventListener(UI_SCALE_CHANGE_EVENT, sync);
    window.addEventListener('storage', event => {
      const key = mode === 'follow-main' ? STORAGE_KEYS.uiScaleMainZoom : STORAGE_KEYS.uiScale;
      if (event.key === key) sync();
    });
    watchDpr();
  });
}
