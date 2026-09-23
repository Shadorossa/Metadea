import { describe, expect, it } from 'vitest';
import { deriveBigPictureTabs, mediaKindForCategory, searchBigPictureItems, type BigPictureItem } from './categories';
import { buildGameItem, buildMediaItem, gameItemKey, isRomGame, sqliteTimestampToUnix, type GameItemContext } from './items';
import type { LocalGame } from '../tauri/local-library';
import type { LibraryEntry } from '../tauri/library';
import type { LocalMediaItem } from '../local/local-media-item';

function item(partial: Partial<BigPictureItem> & Pick<BigPictureItem, 'key' | 'title'>): BigPictureItem {
  return { kind: 'game', cover: null, hero: null, category: 'videojuegos', installed: true, favorite: false, lastActivity: null, ...partial };
}

function entry(partial: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: '1', user_id: 'local', external_id: 'x', type: 'anime', status: 'watching', rating: null, rating_2: null,
    progress: 0, progress_2: 0, minutes_spent: 0, is_favorite: 0, is_platinum: 0, tags: null, notes: null,
    added_at: null, updated_at: null, selected_platform: null, selected_version: null, started_at: null, finished_at: null,
    ...partial,
  };
}

describe('deriveBigPictureTabs', () => {
  const items: BigPictureItem[] = [
    item({ key: 'g1', title: 'Zelda', romPlatform: 'switch', lastActivity: 300 }),
    item({ key: 'g2', title: 'Hades', lastActivity: 500, favorite: true }),
    item({ key: 'g3', title: 'Portal' }),
    item({ key: 'g4', title: 'Okami', romPlatform: 'ps2' }),
    item({ key: 'g5', title: 'Unowned', installed: false }),
    item({ key: 'm1', title: 'Frieren', kind: 'media', category: 'anime', mediaKind: 'anime', lastActivity: 400 }),
    item({ key: 'm2', title: 'Berserk', kind: 'media', category: 'comics', mediaKind: 'manga', favorite: true }),
  ];

  it('always has All (alphabetical) and only non-empty tabs, in a fixed order', () => {
    const tabs = deriveBigPictureTabs(items, { platformOrder: ['ps2', 'switch'] });
    expect(tabs.map(t => t.id)).toEqual(['all', 'recent', 'installed', 'emu:ps2', 'emu:switch', 'media:anime', 'media:manga', 'favorites']);
    expect(tabs[0].items.map(i => i.title)).toEqual(['Berserk', 'Frieren', 'Hades', 'Okami', 'Portal', 'Unowned', 'Zelda']);
  });

  it('orders Recently played by last activity and caps it', () => {
    const tabs = deriveBigPictureTabs(items, { recentLimit: 2 });
    expect(tabs.find(t => t.id === 'recent')?.items.map(i => i.key)).toEqual(['g2', 'm1']);
  });

  it('keeps ROMs and not-installed games out of Installed games', () => {
    const installed = deriveBigPictureTabs(items).find(t => t.id === 'installed');
    expect(installed?.items.map(i => i.key)).toEqual(['g2', 'g3']);
  });

  it('puts unknown platforms after the known order, alphabetically', () => {
    const tabs = deriveBigPictureTabs([
      item({ key: 'a', title: 'A', romPlatform: 'zzz' }),
      item({ key: 'b', title: 'B', romPlatform: 'aaa' }),
      item({ key: 'c', title: 'C', romPlatform: 'ps2' }),
    ], { platformOrder: ['ps2'] });
    expect(tabs.filter(t => t.kind === 'emulated').map(t => t.platform)).toEqual(['ps2', 'aaa', 'zzz']);
  });

  it('returns just All for an empty library', () => {
    expect(deriveBigPictureTabs([])).toEqual([{ id: 'all', kind: 'all', items: [] }]);
  });

  it('groups comics with manga and keeps light novels apart from books', () => {
    expect(mediaKindForCategory('comics')).toBe('manga');
    expect(mediaKindForCategory('light-novel')).toBe('lnovel');
    expect(mediaKindForCategory('books')).toBe('books');
    expect(mediaKindForCategory('videojuegos')).toBeUndefined();
  });
});

describe('searchBigPictureItems', () => {
  const items = [item({ key: '1', title: 'Pokémon Emerald' }), item({ key: '2', title: 'Super Mario' }), item({ key: '3', title: 'Paper Mario' })];
  it('matches accent-insensitively, prefix matches first', () => {
    expect(searchBigPictureItems(items, 'pokemon').map(i => i.key)).toEqual(['1']);
    expect(searchBigPictureItems(items, 'mario').map(i => i.key)).toEqual(['3', '2']);
    expect(searchBigPictureItems(items, 'super').map(i => i.key)).toEqual(['2']);
    expect(searchBigPictureItems(items, '   ')).toEqual([]);
    expect(searchBigPictureItems(items, 'o', 2)).toHaveLength(2);
  });
});

describe('buildGameItem', () => {
  const ctx = (entries: LibraryEntry[] = []): GameItemContext => ({
    art: g => (g.app_id === '10' ? { cover: 'asset://cover.jpg', banner: 'asset://banner.jpg' } : undefined),
    candidateIds: g => (g.external_id ? [g.external_id] : []),
    catalogById: new Map([['game:7', { external_id: 'game:7', type: 'game', title_main: 'Okami HD', cover_url: 'https://images.igdb.com/igdb/image/upload/t_cover_big/x.jpg' }]]),
    entryById: new Map(entries.map(e => [e.external_id, e])),
  });

  it('uses the cached art, launcher name for Steam and library favourites/playtime', () => {
    const steam: LocalGame = { name: 'Hades', launcher: 'steam', app_id: '10', last_played: 1700000000, playtime_minutes: 90, external_id: 'game:1' };
    const built = buildGameItem(steam, ctx([entry({ external_id: 'game:1', type: 'game', is_favorite: 1, status: 'playing' })]));
    expect(built).toMatchObject({
      key: 'game:steam:10', kind: 'game', title: 'Hades', cover: 'asset://cover.jpg', hero: 'asset://banner.jpg',
      favorite: true, lastActivity: 1700000000, playtimeMinutes: 90, externalId: 'game:1', installed: true, romPlatform: undefined,
    });
  });

  it('treats a ROM as emulated and prefers the catalog title and cover', () => {
    const rom: LocalGame = { name: 'okami (usa).iso', launcher: 'playstation', install_path: 'D:/roms/okami.iso', rom_platform: 'ps2', external_id: 'game:7' };
    expect(isRomGame(rom)).toBe(true);
    const built = buildGameItem(rom, ctx([entry({ external_id: 'game:7', type: 'game', minutes_spent: 0, progress: 2 })]));
    expect(built.title).toBe('Okami HD');
    expect(built.romPlatform).toBe('ps2');
    expect(built.cover).toContain('t_cover_');
    expect(built.playtimeMinutes).toBe(120);
    expect(built.lastActivity).toBeNull();
  });

  it('does not treat an .exe as a ROM and flags uninstalled store games', () => {
    const exe: LocalGame = { name: 'Tool', launcher: 'local', install_path: 'C:/x/tool.exe', rom_platform: 'ps2', installed: false };
    expect(isRomGame(exe)).toBe(false);
    expect(buildGameItem(exe, ctx()).installed).toBe(false);
    expect(gameItemKey(exe)).toBe('game:local:C:/x/tool.exe');
  });
});

describe('buildMediaItem', () => {
  const media = (type: string, status = 'watching', progress = 3): LocalMediaItem => ({
    externalId: `${type}:1`, title: 'Work', titleRomaji: null, titleNative: null,
    cover: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/x.jpg',
    status, progress,
    libraryEntry: entry({ external_id: `${type}:1`, type, status, progress, updated_at: '2026-09-01 10:00:00', is_favorite: 1 }),
    catalogEntry: { external_id: `${type}:1`, type, total_count: 12 },
  });

  it('maps video works to episodes and their Local category', () => {
    const built = buildMediaItem(media('anime'));
    expect(built).toMatchObject({
      key: 'media:anime:1', kind: 'media', category: 'anime', mediaKind: 'anime', favorite: true,
      progress: { current: 3, total: 12, unit: 'episode' }, lastActivity: sqliteTimestampToUnix('2026-09-01 10:00:00'),
    });
    expect(built?.cover).toContain('/cover/medium/');
  });

  it('maps reading works to chapters and planned works to no recent activity', () => {
    const built = buildMediaItem(media('comic', 'planning', 0));
    expect(built?.mediaKind).toBe('manga');
    expect(built?.progress?.unit).toBe('chapter');
    expect(built?.lastActivity).toBeNull();
  });

  it('skips games and visual novels (they come from the scanned installs)', () => {
    expect(buildMediaItem(media('game'))).toBeNull();
    expect(buildMediaItem(media('vnovel'))).toBeNull();
  });
});

describe('sqliteTimestampToUnix', () => {
  it('reads SQLite UTC timestamps and ISO strings', () => {
    expect(sqliteTimestampToUnix('1970-01-01 00:01:00')).toBe(60);
    expect(sqliteTimestampToUnix('1970-01-01T00:02:00Z')).toBe(120);
    expect(sqliteTimestampToUnix('nope')).toBeNull();
    expect(sqliteTimestampToUnix(null)).toBeNull();
  });
});
