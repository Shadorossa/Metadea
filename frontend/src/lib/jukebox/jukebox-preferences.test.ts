import { describe, it, expect } from 'vitest';
import { STORAGE_KEYS } from '../storage/storage-keys';
import {
  DEFAULT_JUKEBOX_PREFERENCES, parseJukeboxPreferences, readJukeboxPreferences, serializeJukeboxPreferences,
  writeJukeboxPreferences, type PreferenceStorage,
} from './jukebox-preferences';

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
  };
}

describe('parseJukeboxPreferences', () => {
  it('returns defaults for a missing or broken slot', () => {
    expect(parseJukeboxPreferences(null)).toEqual(DEFAULT_JUKEBOX_PREFERENCES);
    expect(parseJukeboxPreferences('')).toEqual(DEFAULT_JUKEBOX_PREFERENCES);
    expect(parseJukeboxPreferences('{not json')).toEqual(DEFAULT_JUKEBOX_PREFERENCES);
    expect(parseJukeboxPreferences('"a string"')).toEqual(DEFAULT_JUKEBOX_PREFERENCES);
    expect(parseJukeboxPreferences('null')).toEqual(DEFAULT_JUKEBOX_PREFERENCES);
  });

  it('keeps valid fields and repairs invalid ones individually', () => {
    expect(parseJukeboxPreferences(JSON.stringify({ volume: 0.4, shuffle: true, repeat: 'one', lastKey: 'a::OP1' })))
      .toEqual({ volume: 0.4, shuffle: true, repeat: 'one', lastKey: 'a::OP1' });
    expect(parseJukeboxPreferences(JSON.stringify({ volume: 7, shuffle: 'yes', repeat: 'twice', lastKey: '' })))
      .toEqual({ volume: 1, shuffle: false, repeat: 'off', lastKey: null });
    expect(parseJukeboxPreferences(JSON.stringify({ volume: -1 })).volume).toBe(0);
    expect(parseJukeboxPreferences(JSON.stringify({ lastKey: 42 })).lastKey).toBeNull();
  });
});

describe('serialize / read / write', () => {
  it('round-trips through an injected storage under the registered key', () => {
    const storage = memoryStorage();
    writeJukeboxPreferences({ volume: 0.25, shuffle: true, repeat: 'all', lastKey: 'b::ED2' }, storage);
    expect(Object.keys(storage.data)).toEqual([STORAGE_KEYS.jukeboxPreferences]);
    expect(readJukeboxPreferences(storage)).toEqual({ volume: 0.25, shuffle: true, repeat: 'all', lastKey: 'b::ED2' });
  });

  it('clamps the volume on the way out', () => {
    expect(JSON.parse(serializeJukeboxPreferences({ volume: 3, shuffle: false, repeat: 'off', lastKey: null })).volume).toBe(1);
  });

  it('falls back to defaults without a storage or when it throws', () => {
    expect(readJukeboxPreferences(null)).toEqual(DEFAULT_JUKEBOX_PREFERENCES);
    const throwing: PreferenceStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(readJukeboxPreferences(throwing)).toEqual(DEFAULT_JUKEBOX_PREFERENCES);
    expect(() => writeJukeboxPreferences(DEFAULT_JUKEBOX_PREFERENCES, throwing)).not.toThrow();
    expect(() => writeJukeboxPreferences(DEFAULT_JUKEBOX_PREFERENCES, null)).not.toThrow();
  });
});
