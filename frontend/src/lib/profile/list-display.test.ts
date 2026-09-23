import { describe, expect, it, vi, afterEach } from 'vitest';
import type { FavoriteCustomImage, ListItemFull, CatalogSummary } from '../tauri';
import { HOF_GRADIENTS } from './hof';
import { fallbackGradient, nextUntitledListName, resolveListItemDisplay, sortListItems } from './list-display';

function item(overrides: Partial<ListItemFull> & { external_id: string }): ListItemFull {
  return {
    position: 0, library_id: null, status: null, rating: null, progress: 0, progress_2: 0,
    is_favorite: false, is_platinum: false, title_main: null, cover_url: null, media_type: null, format: null,
    ...overrides,
  };
}

function catalog(entries: Array<Partial<CatalogSummary> & { external_id: string }>): Map<string, CatalogSummary> {
  return new Map(entries.map(e => [e.external_id, { id: e.external_id, ...e } as CatalogSummary]));
}

// Makes wrapAssetUrl (lib/tauri/bridge.ts) believe it runs inside Tauri, with
// the convertFileSrc the real runtime injects.
function stubTauriWindow() {
  vi.stubGlobal('window', { __TAURI__: { core: { convertFileSrc: (path: string) => `asset://localhost/${path}` } } });
}

describe('fallbackGradient', () => {
  it('returns the gradient of a known type', () => {
    expect(fallbackGradient('game')).toBe(HOF_GRADIENTS.game);
  });

  it('falls back to the anime gradient for null/undefined', () => {
    expect(fallbackGradient(null)).toBe(HOF_GRADIENTS.anime);
    expect(fallbackGradient(undefined)).toBe(HOF_GRADIENTS.anime);
  });

  it('returns the neutral gradient for an unknown type', () => {
    expect(fallbackGradient('podcast')).toBe('linear-gradient(160deg,#374151,#1f2937)');
  });
});

describe('nextUntitledListName', () => {
  it('returns the base when it is free', () => {
    expect(nextUntitledListName(['Other'], 'Sin título')).toBe('Sin título');
  });

  it('appends the first free counter starting at 1', () => {
    expect(nextUntitledListName(['Sin título'], 'Sin título')).toBe('Sin título 1');
    expect(nextUntitledListName(['Sin título', 'Sin título 1', 'Sin título 2'], 'Sin título')).toBe('Sin título 3');
  });

  it('fills a gap in the counters', () => {
    expect(nextUntitledListName(['Sin título', 'Sin título 2'], 'Sin título')).toBe('Sin título 1');
  });
});

describe('sortListItems', () => {
  const items = [
    item({ external_id: 'anime:1', title_main: 'Zeta', position: 0 }),
    item({ external_id: 'anime:2', title_main: null, position: 1 }),
    item({ external_id: 'anime:3', title_main: 'Alpha', position: 2 }),
    item({ external_id: 'anime:4', title_main: 'Mid', position: 3 }),
  ];
  const catalogMap = catalog([
    { external_id: 'anime:1', release_year: 2020, release_month: 5, release_day: 3 },
    { external_id: 'anime:3', release_year: 2020, release_month: 5, release_day: 1 },
    { external_id: 'anime:4', release_year: 2019 },
  ]);

  it('returns the very same array for custom order', () => {
    expect(sortListItems(items, 'custom', catalogMap)).toBe(items);
  });

  it('sorts alphabetically by title, falling back to the external id', () => {
    expect(sortListItems(items, 'alphabetical', catalogMap).map(i => i.external_id))
      .toEqual(['anime:3', 'anime:2', 'anime:4', 'anime:1']);
  });

  it('sorts by release date with unknown dates last and position as tiebreaker', () => {
    const withTie = [
      ...items,
      item({ external_id: 'anime:5', title_main: 'Tie', position: 4 }),
    ];
    expect(sortListItems(withTie, 'release', catalogMap).map(i => i.external_id))
      .toEqual(['anime:4', 'anime:3', 'anime:1', 'anime:2', 'anime:5']);
  });

  it('does not mutate the input when sorting', () => {
    const copy = [...items];
    sortListItems(items, 'alphabetical', catalogMap);
    expect(items).toEqual(copy);
  });
});

describe('resolveListItemDisplay', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('links a plain media item to /media with its own cover and title', () => {
    const display = resolveListItemDisplay(item({ external_id: 'anime:1', title_main: 'Naruto', cover_url: 'c.png' }), false, false);
    expect(display).toEqual({ cover: 'c.png', coverWorkId: 'anime:1', isEpItem: false, url: '/media?id=anime%3A1', epBadge: null, title: 'Naruto' });
  });

  it('falls back to the external id as title and an empty cover', () => {
    const display = resolveListItemDisplay(item({ external_id: 'anime:1' }), false, false);
    expect(display.title).toBe('anime:1');
    expect(display.cover).toBe('');
  });

  it('prefers a custom image over the item cover', () => {
    const customImagesMap = new Map<string, FavoriteCustomImage>([
      ['anime:1', { external_id: 'anime:1', list_name: 'x', file_name: 'f', image_url: 'custom.png', bg_size: 1, pos_x: 0, pos_y: 0, updated_at: '' }],
    ]);
    expect(resolveListItemDisplay(item({ external_id: 'anime:1', cover_url: 'c.png' }), false, false, customImagesMap).cover).toBe('custom.png');
  });

  it('maps a light row\'s portrait file path to an asset URL inside Tauri, leaving remote covers alone', () => {
    stubTauriWindow();
    const portrait = resolveListItemDisplay(item({ external_id: 'character:9', cover_url: 'C:\\data\\characters\\9.webp' }), true, false);
    expect(portrait.cover).toBe('asset://localhost/C:\\data\\characters\\9.webp');
    const remote = resolveListItemDisplay(item({ external_id: 'anime:1', cover_url: 'https://cdn.example.com/c.png' }), false, false);
    expect(remote.cover).toBe('https://cdn.example.com/c.png');
    expect(resolveListItemDisplay(item({ external_id: 'anime:2' }), false, false).cover).toBe('');
  });

  it('links a character item to /character, by id prefix or by list type', () => {
    expect(resolveListItemDisplay(item({ external_id: 'character:9' }), false, false).url).toBe('/character?id=character%3A9');
    expect(resolveListItemDisplay(item({ external_id: 'anime:9' }), true, false).url).toBe('/character?id=anime%3A9');
  });

  it('links an episode item to its parent media with a season/episode badge', () => {
    const display = resolveListItemDisplay(item({ external_id: 'episode:series:42:2:7' }), false, false);
    expect(display.isEpItem).toBe(true);
    expect(display.url).toBe('/media?id=series%3A42');
    expect(display.epBadge).toBe('T2 E7');
  });

  it('uses an "Ep." badge for season 0', () => {
    expect(resolveListItemDisplay(item({ external_id: 'episode:series:42:0:3' }), false, false).epBadge).toBe('Ep. 3');
  });

  it('keeps a short episode id on /media without a badge', () => {
    const display = resolveListItemDisplay(item({ external_id: 'episode:series:42' }), false, true);
    expect(display.isEpItem).toBe(true);
    expect(display.url).toBe('/media?id=episode%3Aseries%3A42');
    expect(display.epBadge).toBeNull();
  });
});
