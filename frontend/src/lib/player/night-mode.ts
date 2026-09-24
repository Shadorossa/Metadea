// Night mode / clear dialogue: the player's "even out the loudness and lift
// the voices" toggle. This module is the remembered choice (device-level,
// default off) as a store every player window sees: the overlay window and
// the main window each load their own copy, so a change made in one reaches
// the other through the `storage` event. The engine side (the labelled mpv
// `af` chain and its fallbacks) is src-tauri/src/player/night_mode.rs; the
// controls apply the choice through components/player/hooks/usePlayerNightMode.

import { createExternalStore } from '../shared/state/external-store';
import { STORAGE_KEYS } from '../storage/storage-keys';
import type { NightModeLevel } from '../tauri/player';

export function parseNightMode(raw: string | null | undefined): boolean {
  return raw === 'on';
}

export function serializeNightMode(enabled: boolean): string {
  return enabled ? 'on' : 'off';
}

/** The chain is actually filtering the audio (full or fallback). */
export function isNightModeActive(level: NightModeLevel): boolean {
  return level === 'full' || level === 'basic';
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export const nightModeStore = createExternalStore<boolean>(parseNightMode(storage()?.getItem(STORAGE_KEYS.playerNightMode)));

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEYS.playerNightMode) nightModeStore.set(parseNightMode(event.newValue));
  });
}

export function setNightModeEnabled(enabled: boolean): void {
  try {
    storage()?.setItem(STORAGE_KEYS.playerNightMode, serializeNightMode(enabled));
  } catch { /* quota / blocked storage: still toggles for this session */ }
  nightModeStore.set(enabled);
}

export function toggleNightMode(): void {
  setNightModeEnabled(!nightModeStore.get());
}
