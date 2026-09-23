// Parity: Search's results after the exclusion helpers moved to
// exclusion-filters.ts — blocked and reclassified ids still drop out of a
// provider page, nothing else does, and the order is unchanged.
import { describe, expect, it, vi } from 'vitest';
import type { SearchResult } from './types';

function game(id: number, type: 'game' | 'vnovel' = 'game'): SearchResult {
  return {
    externalId: `${type}:${id}`, type, title: `Title ${id}`, coverUrl: null, format: 'GAME',
    releaseYear: 2000 + id, scoreGlobal: null, genres: [],
  } as unknown as SearchResult;
}

const FIXTURE: SearchResult[] = [game(1), game(2), game(3), game(4, 'vnovel'), game(5)];

vi.mock('./providers/igdb', () => ({
  searchGames: vi.fn(async () => ({ results: FIXTURE, hasMore: true })),
  searchGameBundles: vi.fn(),
  searchGameExpandedEditions: vi.fn(),
  searchGameRemasters: vi.fn(),
}));
vi.mock('../tauri/catalog', () => ({
  searchCatalog: vi.fn(async () => []),
  getBlockedExternalIds: vi.fn(async () => ['game:3', 'anime:77']),
  getReclassifiedExternalIds: vi.fn(async (ids: string[]) => ids.filter(id => id === 'vnovel:4')),
}));
vi.mock('../tauri', () => ({
  getCustomImagesMap: vi.fn(async () => ({})),
  wrapAssetUrl: (url: string) => url,
  getMediaRelations: vi.fn(async () => []),
}));
vi.mock('../tauri/characters', () => ({ searchCharactersDb: vi.fn(async () => []) }));

describe('Search exclusions (parity)', () => {
  it('drops blocked and reclassified ids from a provider page, keeping the rest in order', async () => {
    const { topRated } = await import('./index');
    const page = await topRated('game', new AbortController().signal);
    expect(page.results.map(r => r.externalId)).toEqual(['game:1', 'game:2', 'game:5']);
    expect(page.hasMore).toBe(true);
  });

  it('returns the page untouched when nothing is blocked or reclassified', async () => {
    const catalog = await import('../tauri/catalog');
    vi.mocked(catalog.getBlockedExternalIds).mockResolvedValueOnce([]);
    vi.mocked(catalog.getReclassifiedExternalIds).mockResolvedValueOnce([]);
    const { topRated } = await import('./index');
    const page = await topRated('game', new AbortController().signal);
    expect(page.results.map(r => r.externalId)).toEqual(FIXTURE.map(r => r.externalId));
  });
});
