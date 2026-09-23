// Vite's ?raw import keeps this free of node typings (the project has none).
import homePage from '../../pages/home.astro?raw';
import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../storage/storage-keys';
import {
  clearHomeSnapshot,
  libraryVersion,
  localDateKey,
  readHomeSnapshot,
  sameIds,
  snapshotAnniversary,
  snapshotCalendar,
  updateHomeSnapshot,
} from './home-snapshot';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    map,
  };
}

const today = new Date(2026, 8, 23, 12);
const anniversaryItem = { externalId: 'game:136', type: 'game', title: 'DMC3', coverUrl: null, year: 2022, yearsAgo: 4 };

describe('home snapshot', () => {
  it('round-trips slices and writes the layout hint', () => {
    const storage = memoryStorage();
    updateHomeSnapshot({ date: localDateKey(today), anniversary: [anniversaryItem] }, storage);
    updateHomeSnapshot({
      calendarMonth: '2026-09',
      calendar: [{ day: 30, month: 9, year: 2026, releaseDate: new Date(2026, 8, 30), title: 'X', type: 'anime', cover: '', externalId: 'anime:a:1' }],
    }, storage);

    const snapshot = readHomeSnapshot(storage);
    expect(snapshotAnniversary(snapshot, today)).toEqual([anniversaryItem]);
    const calendar = snapshotCalendar(snapshot, today);
    expect(calendar?.[0].releaseDate).toBeInstanceOf(Date);
    expect(calendar?.[0].releaseDate.getDate()).toBe(30);
    expect(JSON.parse(storage.map.get(STORAGE_KEYS.homeLayoutHint)!)).toEqual({ d: '2026-09-23', a: 1, g: 0, f: 0, fp: 0, c: 0 });
  });

  it('ignores slices for another day or month', () => {
    const storage = memoryStorage();
    updateHomeSnapshot({ date: '2026-09-22', anniversary: [anniversaryItem], calendarMonth: '2026-08' }, storage);
    const snapshot = readHomeSnapshot(storage);
    expect(snapshotAnniversary(snapshot, today)).toBeNull();
    expect(snapshotCalendar(snapshot, today)).toBeNull();
  });

  it('treats garbage, other versions and cleared storage as no snapshot', () => {
    const storage = memoryStorage();
    storage.setItem(STORAGE_KEYS.homeSnapshot, '{nope');
    expect(readHomeSnapshot(storage)).toBeNull();
    storage.setItem(STORAGE_KEYS.homeSnapshot, JSON.stringify({ v: 1 }));
    expect(readHomeSnapshot(storage)).toBeNull();
    updateHomeSnapshot({ date: '2026-09-23' }, storage);
    clearHomeSnapshot(storage);
    expect(readHomeSnapshot(storage)).toBeNull();
    expect(storage.map.has(STORAGE_KEYS.homeLayoutHint)).toBe(false);
  });

  it('fingerprints the library and compares id lists', () => {
    expect(libraryVersion([{ updated_at: '2026-01-02' }, { updated_at: null }, { updated_at: '2026-03-01' }])).toBe('3:2026-03-01');
    expect(sameIds([{ id: 'a' }], [{ id: 'a' }], x => x.id)).toBe(true);
    expect(sameIds([{ id: 'a' }], [{ id: 'b' }], x => x.id)).toBe(false);
  });

  it('home.astro pre-paint script reads the same layout-hint key', () => {
    expect(homePage).toContain(`'${STORAGE_KEYS.homeLayoutHint}'`);
  });
});
