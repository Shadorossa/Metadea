import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCoverPreference, getPreferredCover, readCoverPreferences } from './cover-preferences';
import { STORAGE_KEYS } from '../storage/storage-keys';

function installLocalStorage(initial: Record<string, string> = {}): { getItemCalls: number } {
  const store = new Map(Object.entries(initial));
  const stats = { getItemCalls: 0 };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => { stats.getItemCalls++; return store.get(key) ?? null; },
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    },
  });
  return stats;
}

describe('cover preferences reader', () => {
  let stats: { getItemCalls: number };

  beforeEach(() => {
    stats = installLocalStorage({
      [STORAGE_KEYS.mediaCoverPreferences]: JSON.stringify({
        'game:1': 'https://cdn.example/custom.webp',
        'game:2': 'javascript:alert(1)',
        'game:3': 'asset://localhost/cover.webp',
      }),
    });
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('parses the stored map once per readCoverPreferences call', () => {
    const prefs = readCoverPreferences();
    expect(prefs).toEqual({
      'game:1': 'https://cdn.example/custom.webp',
      'game:2': 'javascript:alert(1)',
      'game:3': 'asset://localhost/cover.webp',
    });
    expect(stats.getItemCalls).toBe(1);
  });

  it('does not touch localStorage again when a pre-read map is passed', () => {
    const prefs = readCoverPreferences();
    const before = stats.getItemCalls;
    expect(getCoverPreference('game:1', prefs)).toBe('https://cdn.example/custom.webp');
    expect(getPreferredCover('game:1', 'https://cdn.example/original.jpg', prefs)).toBe('https://cdn.example/custom.webp');
    expect(getPreferredCover('game:99', 'https://cdn.example/original.jpg', prefs)).toBe('https://cdn.example/original.jpg');
    expect(stats.getItemCalls).toBe(before);
  });

  it('keeps reading from storage when no map is passed (legacy call shape)', () => {
    expect(getPreferredCover('game:1', null)).toBe('https://cdn.example/custom.webp');
    expect(stats.getItemCalls).toBe(1);
    expect(getPreferredCover('game:99', null)).toBeNull();
    expect(stats.getItemCalls).toBe(2);
  });

  it('only accepts http(s)/asset/data URLs as preferences', () => {
    const prefs = readCoverPreferences();
    expect(getCoverPreference('game:2', prefs)).toBeNull();
    expect(getCoverPreference('game:3', prefs)).toBe('asset://localhost/cover.webp');
    expect(getPreferredCover('game:2', 'https://cdn.example/fallback.jpg', prefs)).toBe('https://cdn.example/fallback.jpg');
    expect(getPreferredCover('game:2', undefined, prefs)).toBeNull();
  });

  it('returns an empty map for missing or corrupt storage', () => {
    installLocalStorage({ [STORAGE_KEYS.mediaCoverPreferences]: '{not json' });
    expect(readCoverPreferences()).toEqual({});
    installLocalStorage({ [STORAGE_KEYS.mediaCoverPreferences]: '"a string"' });
    expect(readCoverPreferences()).toEqual({});
    installLocalStorage();
    expect(readCoverPreferences()).toEqual({});
  });
});
