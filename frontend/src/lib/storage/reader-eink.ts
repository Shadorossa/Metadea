// E-Ink / paper mode preferences of the readers, remembered per reader type
// (a manga read on paper does not force the EPUB reader into it). A
// per-viewer convenience: storage failing (private window, blocked site
// data) just falls back to the defaults, and the reading never stops.
import { STORAGE_KEYS } from './storage-keys';
import { DEFAULT_EINK_PREFERENCES, normalizeEinkPreferences, type EinkPreferences, type EinkReaderKind } from '../reader/eink-mode';

export interface EinkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): EinkStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function einkStorageKey(kind: EinkReaderKind): string {
  return `${STORAGE_KEYS.readerEink}:${kind}`;
}

export function readEinkPreferences(kind: EinkReaderKind, storage: EinkStorage | null = defaultStorage()): EinkPreferences {
  if (!storage) return { ...DEFAULT_EINK_PREFERENCES };
  try {
    const raw = storage.getItem(einkStorageKey(kind));
    return normalizeEinkPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_EINK_PREFERENCES };
  }
}

export function saveEinkPreferences(kind: EinkReaderKind, prefs: EinkPreferences, storage: EinkStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(einkStorageKey(kind), JSON.stringify(normalizeEinkPreferences(prefs)));
  } catch {
    // Not remembered this time; the reader still switches.
  }
}
