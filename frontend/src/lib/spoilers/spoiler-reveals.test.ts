import { describe, it, expect } from 'vitest';
import { createSpoilerReveals, spoilerItemKey } from './spoiler-reveals';
import { readSpoilerSettings, writeSpoilerSettings, DEFAULT_SPOILER_SETTINGS } from './spoiler-settings';
import { STORAGE_KEYS } from '../storage/storage-keys';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

describe('spoiler reveals', () => {
  it('remembers a single item in session storage only', () => {
    const session = memoryStorage();
    const local = memoryStorage();
    const reveals = createSpoilerReveals(session, local);
    const key = spoilerItemKey.episode('anime:1', 16);
    expect(reveals.isItemRevealed(key)).toBe(false);
    reveals.revealItem(key);
    expect(reveals.isItemRevealed(key)).toBe(true);
    expect(local.data.size).toBe(0);
    // A new page load in the same session reads it back.
    expect(createSpoilerReveals(session, local).isItemRevealed(key)).toBe(true);
    // A new session (fresh sessionStorage) does not.
    expect(createSpoilerReveals(memoryStorage(), local).isItemRevealed(key)).toBe(false);
  });

  it('persists a franchise reveal and matches it through any member', () => {
    const local = memoryStorage();
    const reveals = createSpoilerReveals(memoryStorage(), local);
    reveals.revealFranchise(['anime:1', 'anime:2']);
    const reloaded = createSpoilerReveals(memoryStorage(), local);
    expect(reloaded.isFranchiseRevealed(['anime:2', 'anime:3'])).toBe(true);
    expect(reloaded.isFranchiseRevealed(['manga:10'])).toBe(false);
  });

  it('notifies subscribers and survives unreadable storage', () => {
    const reveals = createSpoilerReveals(memoryStorage({ [STORAGE_KEYS.spoilerSessionReveals]: 'not json' }), null);
    let calls = 0;
    reveals.store.subscribe(() => { calls++; });
    reveals.revealItem('arc:1');
    reveals.revealItem('arc:1');
    reveals.revealFranchise(['anime:1']);
    expect(calls).toBe(2);
    expect(reveals.isFranchiseRevealed(['anime:1'])).toBe(true);
  });
});

describe('spoiler settings', () => {
  it('defaults to on / normal / covers visible', () => {
    expect(readSpoilerSettings(memoryStorage())).toEqual(DEFAULT_SPOILER_SETTINGS);
    expect(readSpoilerSettings(null)).toEqual(DEFAULT_SPOILER_SETTINGS);
  });

  it('round-trips every setting', () => {
    const storage = memoryStorage();
    writeSpoilerSettings({ enabled: false, level: 'strict', hideFutureCovers: true }, storage);
    expect(readSpoilerSettings(storage)).toEqual({ enabled: false, level: 'strict', hideFutureCovers: true });
  });
});
