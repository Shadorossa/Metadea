import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaCatalogEntry } from '../tauri/catalog';
import type { MediaPageData } from './types';

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  getBlockedExternalIds: vi.fn(async () => [] as string[]),
  saveCatalogEntry: vi.fn(async () => {}),
  getSyncState: vi.fn(async () => null),
  setSyncState: vi.fn(async () => {}),
}));

import { getBlockedExternalIds, saveCatalogEntry, getSyncState, setSyncState } from '../tauri';
import {
  NEW_DATA_COMPARE_FIELDS, isLowTierAniListCover, mergeShopLinksCsv,
  filterBlockedRelations, applyStickyLocalFields, persistToCatalog,
} from './media-page-persist';

const page = (extra: Partial<MediaPageData> = {}): MediaPageData => ({
  externalId: 'game:1', type: 'game', titleMain: 'Live Title', bannerColor: '',
  metaLines: [], stats: [], characters: [], relations: [], progressStatus: 'playing', progressLabel: '',
  ...extra,
});

const catalogEntry = (overrides: Partial<MediaCatalogEntry> = {}): MediaCatalogEntry => ({
  id: 'row', external_id: 'game:1', type: 'game', title_main: 'Curated Title', created_at: '', updated_at: '', ...overrides,
} as MediaCatalogEntry);

beforeEach(() => { vi.clearAllMocks(); });

describe('isLowTierAniListCover', () => {
  it('flags only AniList medium/small cover tiers', () => {
    expect(isLowTierAniListCover('https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1.jpg')).toBe(true);
    expect(isLowTierAniListCover('https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/bx1.jpg')).toBe(true);
    expect(isLowTierAniListCover('https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx1.jpg')).toBe(false);
    expect(isLowTierAniListCover('https://images.igdb.com/cover/medium/x.jpg')).toBe(false);
    expect(isLowTierAniListCover(null)).toBe(false);
    expect(isLowTierAniListCover(undefined)).toBe(false);
  });
});

describe('mergeShopLinksCsv', () => {
  it('keeps the existing URL for a known platform and appends new platforms', () => {
    expect(mergeShopLinksCsv('steam|old-steam', [
      { platform: 'steam', url: 'new-steam' },
      { platform: 'nintendo', url: 'nin' },
    ])).toBe('steam|old-steam,nintendo|nin');
  });

  it('ignores malformed pairs and empty halves, and returns null when nothing survives', () => {
    expect(mergeShopLinksCsv('garbage,|only-url,steam|', [{ platform: '', url: 'x' }, { platform: 'gog', url: '' }])).toBeNull();
    expect(mergeShopLinksCsv(null, [])).toBeNull();
    expect(mergeShopLinksCsv(undefined, [{ platform: 'gog', url: 'g' }])).toBe('gog|g');
  });
});

describe('filterBlockedRelations', () => {
  const relations = [
    { title: 'a', relatedExternalId: 'game:2' },
    { title: 'b', relatedExternalId: 'game:3', format: ' summary ' },
    { title: 'c' },
    { title: 'd', relatedExternalId: 'game:4' },
  ];

  it('drops SUMMARY-format relations and blocked targets, keeping target-less ones', async () => {
    expect(await filterBlockedRelations(relations, ['game:4'])).toEqual([
      { title: 'a', relatedExternalId: 'game:2' },
      { title: 'c' },
    ]);
    expect(getBlockedExternalIds).not.toHaveBeenCalled();
  });

  it('reads the blocked list itself when none is supplied', async () => {
    vi.mocked(getBlockedExternalIds).mockResolvedValue(['game:2']);
    expect((await filterBlockedRelations(relations)).map(r => r.title)).toEqual(['c', 'd']);
  });
});

describe('applyStickyLocalFields', () => {
  it('is a no-op without an existing row', () => {
    const data = page();
    applyStickyLocalFields(data, null);
    expect(data).toEqual(page());
  });

  it('lets curated catalog columns override the live fetch, rebuilding the display strings', () => {
    const data = page({ format: 'GAME', cover: 'live.jpg', releaseYear: 2001, platforms: ['PC'] });
    applyStickyLocalFields(data, catalogEntry({
      format: 'REMASTER', synopsis: 'Curated synopsis', cover_url: 'curated.jpg',
      banners_csv: 'b1.jpg,b2.jpg', genres_csv: 'RPG,Action', genres_tag_csv: 'Open world',
      platforms_csv: 'PC,,Switch', release_year: 1999, release_month: 0, status: 'RELEASED',
      issue_source_id: 'cv-1', episode_source_id: null,
    }));
    expect(data).toMatchObject({
      titleMain: 'Curated Title', format: 'REMASTER', description: 'Curated synopsis', cover: 'curated.jpg',
      bannerImage: 'b1.jpg', genreDots: 'RPG · Action', genreTagDots: 'Open world', platforms: ['PC', 'Switch'],
      releaseYear: 1999, releaseMonth: 0, status: 'RELEASED', issueSourceId: 'cv-1',
    });
    expect(data.episodeSourceId).toBeUndefined();
  });

  it('keeps the live cover when the stored one is a low-tier AniList URL', () => {
    const data = page({ externalId: 'anime:1', type: 'anime', cover: 'fresh-large.jpg' });
    applyStickyLocalFields(data, catalogEntry({ cover_url: 'https://s4.anilist.co/x/cover/medium/bx1.jpg' }));
    expect(data.cover).toBe('fresh-large.jpg');
  });

  it('never lets a stored format override an API-Sports competition', () => {
    const data = page({ externalId: 'event:apisports:football:39', type: 'event', format: 'Season' });
    applyStickyLocalFields(data, catalogEntry({ type: 'event', format: 'League' }));
    expect(data.format).toBe('Season');
  });
});

describe('persistToCatalog', () => {
  const savedEntry = () => vi.mocked(saveCatalogEntry).mock.calls[0][0];

  it('writes a fresh row from live data and resets the sync backoff', async () => {
    await persistToCatalog(page({ storeLinks: [{ platform: 'steam', url: 's' }], genreDots: 'A · B', format: 'GAME' }), null, false);
    expect(savedEntry()).toMatchObject({
      external_id: 'game:1', title_main: 'Live Title', source: 'igdb', format: 'GAME',
      shop_links_csv: 'steam|s', genres_csv: 'A,B', blocked_at: null, parent_id: null,
    });
    expect(setSyncState).toHaveBeenCalledWith('game:1', expect.any(String), 0, null);
  });

  it('prefers existing content fields and widens the backoff when nothing changed', async () => {
    const existing = catalogEntry({ title_main: 'Live Title', synopsis: null, cover_url: null, status: null, score_global: null,
      total_count: null, total_count_2: null, genres_csv: null, genres_tag_csv: null, platforms_csv: null, shop_links_csv: null,
      source_url: null, country_code: null, title_native: null, title_romaji: null, title_english: null, format: 'REMASTER' });
    vi.mocked(getSyncState).mockResolvedValue({ sync_failed_count: 2, last_synced_at: '' } as never);

    await persistToCatalog(page({ format: 'GAME' }), existing, false);
    expect(savedEntry().format).toBe('REMASTER');
    expect(setSyncState).toHaveBeenCalledWith('game:1', expect.any(String), 3, null);
  });

  it('counts a relations change as new data even when every compared column matches', async () => {
    const existing = catalogEntry({ title_main: 'Live Title' });
    await persistToCatalog(page(), existing, true);
    expect(setSyncState).toHaveBeenCalledWith('game:1', expect.any(String), 0, null);
  });

  it('only refreshes an AniList total_count on the manual retry path', async () => {
    const existing = catalogEntry({ external_id: 'anime:1', type: 'anime', total_count: 12 });
    const data = page({ externalId: 'anime:1', type: 'anime', source: 'anilist', totalCount: 24 });
    await persistToCatalog(data, existing, false);
    expect(savedEntry().total_count).toBe(12);
    vi.clearAllMocks();
    await persistToCatalog(data, existing, false, true);
    expect(savedEntry().total_count).toBe(24);
  });

  it('forces the Season format for API-Sports competitions and auto-blocks AniList recaps', async () => {
    await persistToCatalog(page({ externalId: 'event:apisports:basketball:12', type: 'event', format: 'League' }), null, false);
    expect(savedEntry().format).toBe('Season');
    vi.clearAllMocks();
    await persistToCatalog(page({ externalId: 'anime:1', type: 'anime', source: 'anilist', description: '(Recompilation film) of the first season.' }), null, false);
    expect(savedEntry().blocked_at).toEqual(expect.any(String));
  });

  it('exposes the exact compared-column list needsResync depends on', () => {
    expect(NEW_DATA_COMPARE_FIELDS).toHaveLength(16);
    expect(NEW_DATA_COMPARE_FIELDS).not.toContain('format');
    expect(NEW_DATA_COMPARE_FIELDS).not.toContain('release_year');
  });
});
