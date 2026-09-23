// Spoiler shield settings (Settings > Preferences > Content): on/off
// (default on), level Normal / Strict (Strict also hides the whole
// biography of characters from a protected franchise) and "also hide the
// covers of future seasons/arcs" (default off). Device-level display
// preferences like the rest of that tab, so plain localStorage; every write
// fires SPOILER_SETTINGS_CHANGED_EVENT so mounted pages re-evaluate live.
import { STORAGE_KEYS } from '../storage/storage-keys';

export type SpoilerLevel = 'normal' | 'strict';

export interface SpoilerSettings {
  enabled: boolean;
  level: SpoilerLevel;
  hideFutureCovers: boolean;
}

export const DEFAULT_SPOILER_SETTINGS: SpoilerSettings = {
  enabled: true,
  level: 'normal',
  hideFutureCovers: false,
};

export const SPOILER_SETTINGS_CHANGED_EVENT = 'spoiler-settings-changed';

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

function defaultStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function readItem(storage: ReadableStorage | null, key: string): string | null {
  if (!storage) return null;
  try { return storage.getItem(key); } catch { return null; }
}

/** Anything unexpected in storage reads as the default. */
export function readSpoilerSettings(storage: ReadableStorage | null = defaultStorage()): SpoilerSettings {
  const enabled = readItem(storage, STORAGE_KEYS.spoilerShieldEnabled);
  const level = readItem(storage, STORAGE_KEYS.spoilerShieldLevel);
  const covers = readItem(storage, STORAGE_KEYS.spoilerShieldHideCovers);
  return {
    enabled: enabled === null ? DEFAULT_SPOILER_SETTINGS.enabled : enabled !== 'false',
    level: level === 'strict' ? 'strict' : 'normal',
    hideFutureCovers: covers === null ? DEFAULT_SPOILER_SETTINGS.hideFutureCovers : covers === 'true',
  };
}

export function writeSpoilerSettings(
  patch: Partial<SpoilerSettings>,
  storage: WritableStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  if (patch.enabled !== undefined) storage.setItem(STORAGE_KEYS.spoilerShieldEnabled, String(patch.enabled));
  if (patch.level !== undefined) storage.setItem(STORAGE_KEYS.spoilerShieldLevel, patch.level);
  if (patch.hideFutureCovers !== undefined) storage.setItem(STORAGE_KEYS.spoilerShieldHideCovers, String(patch.hideFutureCovers));
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SPOILER_SETTINGS_CHANGED_EVENT));
}
