// What the jukebox remembers between launches: volume, shuffle, repeat and
// which favourite was loaded last (restored paused, never auto-played).
// Storage is injected so the pure parse/serialize is testable without a DOM.
import { STORAGE_KEYS } from '../storage/storage-keys';
import { clampVolume, type RepeatMode } from './jukebox-store';

export interface JukeboxPreferences {
  volume: number;
  shuffle: boolean;
  repeat: RepeatMode;
  // themeKey() of the last loaded favourite, or null.
  lastKey: string | null;
}

export const DEFAULT_JUKEBOX_PREFERENCES: JukeboxPreferences = {
  volume: 0.8,
  shuffle: false,
  repeat: 'off',
  lastKey: null,
};

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const REPEAT_MODES: RepeatMode[] = ['off', 'all', 'one'];

function isRepeatMode(value: unknown): value is RepeatMode {
  return typeof value === 'string' && (REPEAT_MODES as string[]).includes(value);
}

// Tolerant of anything in the slot: a missing key, malformed JSON or a
// half-written object all fall back field by field to the defaults.
export function parseJukeboxPreferences(raw: string | null): JukeboxPreferences {
  if (!raw) return { ...DEFAULT_JUKEBOX_PREFERENCES };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_JUKEBOX_PREFERENCES };
  }
  if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_JUKEBOX_PREFERENCES };
  const obj = parsed as Record<string, unknown>;
  return {
    volume: typeof obj.volume === 'number' ? clampVolume(obj.volume) : DEFAULT_JUKEBOX_PREFERENCES.volume,
    shuffle: typeof obj.shuffle === 'boolean' ? obj.shuffle : DEFAULT_JUKEBOX_PREFERENCES.shuffle,
    repeat: isRepeatMode(obj.repeat) ? obj.repeat : DEFAULT_JUKEBOX_PREFERENCES.repeat,
    lastKey: typeof obj.lastKey === 'string' && obj.lastKey.length > 0 ? obj.lastKey : null,
  };
}

export function serializeJukeboxPreferences(prefs: JukeboxPreferences): string {
  return JSON.stringify({
    volume: clampVolume(prefs.volume),
    shuffle: prefs.shuffle,
    repeat: prefs.repeat,
    lastKey: prefs.lastKey,
  });
}

function defaultStorage(): PreferenceStorage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function readJukeboxPreferences(storage: PreferenceStorage | null = defaultStorage()): JukeboxPreferences {
  if (!storage) return { ...DEFAULT_JUKEBOX_PREFERENCES };
  try {
    return parseJukeboxPreferences(storage.getItem(STORAGE_KEYS.jukeboxPreferences));
  } catch {
    return { ...DEFAULT_JUKEBOX_PREFERENCES };
  }
}

// A preference is a convenience, not user data: a storage that refuses the
// write (quota, private mode) just means the next launch starts from the
// defaults, so this never throws.
export function writeJukeboxPreferences(prefs: JukeboxPreferences, storage: PreferenceStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEYS.jukeboxPreferences, serializeJukeboxPreferences(prefs));
  } catch {
    // see above
  }
}
