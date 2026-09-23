import { describe, it, expect } from 'vitest';
import {
  DEFAULT_READER_PREFERENCES,
  READER_PREFERENCES_KEY,
  loadReaderPreferences,
  normalizeReaderPreferences,
  saveReaderPreferences,
  withFontSizeDelta,
  type StorageLike,
} from './reader-preferences';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = value; },
  };
}

describe('normalizeReaderPreferences', () => {
  it('returns the defaults for garbage input', () => {
    expect(normalizeReaderPreferences(null)).toEqual(DEFAULT_READER_PREFERENCES);
    expect(normalizeReaderPreferences('nope')).toEqual(DEFAULT_READER_PREFERENCES);
    expect(normalizeReaderPreferences({ font: 'comic-sans', theme: 7, flow: [] })).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it('clamps numbers into range and snaps them to the step', () => {
    const prefs = normalizeReaderPreferences({ fontSize: 200, lineHeight: 0.2, margin: 13 });
    expect(prefs.fontSize).toBe(36);
    expect(prefs.lineHeight).toBe(1.1);
    expect(prefs.margin).toBe(16);
  });

  it('keeps valid values', () => {
    const prefs = normalizeReaderPreferences({ font: 'lora', theme: 'sepia', flow: 'scroll', justify: false, publisherStyles: false, fontSize: 22 });
    expect(prefs).toMatchObject({ font: 'lora', theme: 'sepia', flow: 'scroll', justify: false, publisherStyles: false, fontSize: 22 });
  });
});

describe('persistence', () => {
  it('round-trips through the storage under one key', () => {
    const storage = memoryStorage();
    const prefs = { ...DEFAULT_READER_PREFERENCES, theme: 'paper' as const, fontSize: 24 };
    saveReaderPreferences(storage, prefs);
    expect(Object.keys(storage.data)).toEqual([READER_PREFERENCES_KEY]);
    expect(loadReaderPreferences(storage)).toEqual(prefs);
  });

  it('falls back to defaults on a missing or corrupt entry', () => {
    expect(loadReaderPreferences(memoryStorage())).toEqual(DEFAULT_READER_PREFERENCES);
    expect(loadReaderPreferences(memoryStorage({ [READER_PREFERENCES_KEY]: '{not json' }))).toEqual(DEFAULT_READER_PREFERENCES);
    expect(loadReaderPreferences(null)).toEqual(DEFAULT_READER_PREFERENCES);
  });

  it('survives a storage that throws', () => {
    const throwing: StorageLike = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(loadReaderPreferences(throwing)).toEqual(DEFAULT_READER_PREFERENCES);
    expect(() => saveReaderPreferences(throwing, DEFAULT_READER_PREFERENCES)).not.toThrow();
  });
});

describe('withFontSizeDelta', () => {
  it('steps and clamps', () => {
    expect(withFontSizeDelta(DEFAULT_READER_PREFERENCES, 2).fontSize).toBe(DEFAULT_READER_PREFERENCES.fontSize + 2);
    expect(withFontSizeDelta({ ...DEFAULT_READER_PREFERENCES, fontSize: 12 }, -5).fontSize).toBe(12);
  });
});
