import { describe, it, expect } from 'vitest';
import { einkStorageKey, readEinkPreferences, saveEinkPreferences, type EinkStorage } from './reader-eink';
import { STORAGE_KEYS } from './storage-keys';
import { DEFAULT_EINK_PREFERENCES } from '../reader/eink-mode';

function memoryStorage(initial: Record<string, string> = {}): EinkStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: key => (key in data ? data[key] : null), setItem: (key, value) => { data[key] = value; } };
}

describe('reader E-Ink preferences storage', () => {
  it('keys each reader type under STORAGE_KEYS.readerEink', () => {
    expect(einkStorageKey('comic')).toBe(`${STORAGE_KEYS.readerEink}:comic`);
    expect(einkStorageKey('epub')).toBe(`${STORAGE_KEYS.readerEink}:epub`);
  });

  it('round-trips per reader type without crosstalk', () => {
    const storage = memoryStorage();
    saveEinkPreferences('comic', { enabled: true, warmth: 0.6, brightness: 0.5, refreshFlash: true }, storage);
    expect(readEinkPreferences('comic', storage)).toEqual({ enabled: true, warmth: 0.6, brightness: 0.5, refreshFlash: true });
    expect(readEinkPreferences('epub', storage)).toEqual(DEFAULT_EINK_PREFERENCES);
  });

  it('falls back to defaults on missing storage, garbage or a throwing store', () => {
    expect(readEinkPreferences('epub', null)).toEqual(DEFAULT_EINK_PREFERENCES);
    expect(readEinkPreferences('epub', memoryStorage({ [einkStorageKey('epub')]: '{nope' }))).toEqual(DEFAULT_EINK_PREFERENCES);
    const throwing: EinkStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
    };
    expect(readEinkPreferences('comic', throwing)).toEqual(DEFAULT_EINK_PREFERENCES);
    expect(() => saveEinkPreferences('comic', DEFAULT_EINK_PREFERENCES, throwing)).not.toThrow();
  });

  it('normalises what it writes', () => {
    const storage = memoryStorage();
    saveEinkPreferences('epub', { enabled: true, warmth: 9, brightness: -1, refreshFlash: false }, storage);
    expect(JSON.parse(storage.data[einkStorageKey('epub')])).toEqual({ enabled: true, warmth: 1, brightness: 0.35, refreshFlash: false });
  });
});
