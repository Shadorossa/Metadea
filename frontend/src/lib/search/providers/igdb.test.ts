import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResult } from '../types';

// The Tauri bridge (igdbSearch) is the module boundary in the desktop app;
// isTauri/readEnvConfig gate which path searchGames takes.
vi.mock('../../tauri/igdb', () => ({
  igdbSearch: vi.fn(),
  igdbImageUrl: (imageId: string, size = 'screenshot_big') => `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`,
}));
vi.mock('../../tauri/bridge', () => ({ isTauri: () => true }));
vi.mock('../../tauri/env', () => ({ readEnvConfig: async () => ({ igdb_client_id: 'id', igdb_client_secret: 'secret' }) }));

import { igdbSearch } from '../../tauri/igdb';
import { searchGames, searchGameBundles } from './igdb';

const searchMock = vi.mocked(igdbSearch);
const signal = () => new AbortController().signal;

// Exactly what igdb.rs hands back for one search hit.
const FULL_ROW = {
  id: 1022,
  name: 'The Legend of Zelda Collection',
  cover: { id: 9, image_id: 'co1abc' },
  first_release_date: 1054598400, // 2003-06-03T00:00:00Z
  rating: 87.6,
  genres: [{ id: 31, name: 'Adventure' }, { id: 12, name: 'Role-playing (RPG)' }],
  category: 0,
};

const FULL_EXPECTED: SearchResult = {
  externalId: 'game:1022',
  type: 'game',
  format: 'GAME',
  source: 'igdb',
  titleMain: 'The Legend of Zelda',
  titleRomaji: null,
  titleNative: null,
  coverUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg',
  releaseYear: 2003,
  releaseMonth: 6,
  releaseDay: 3,
  scoreGlobal: 8.8,
  genres: ['Adventure', 'Role-playing (RPG)'],
};

beforeEach(() => {
  searchMock.mockReset();
});

describe('searchGames', () => {
  it('maps a full IGDB row to the exact SearchResult fields', async () => {
    searchMock.mockResolvedValue({ games: [FULL_ROW], hasMore: true });
    const page = await searchGames('zelda', 'game', signal());
    expect(page).toEqual({ results: [FULL_EXPECTED], hasMore: true });
  });

  it('still maps a row whose optional fields are absent', async () => {
    searchMock.mockResolvedValue({ games: [{ id: 2, name: 'Bare' }], hasMore: false });
    const { results } = await searchGames('bare', 'game', signal());
    expect(results).toEqual([{
      externalId: 'game:2',
      type: 'game',
      format: 'GAME',
      source: 'igdb',
      titleMain: 'Bare',
      titleRomaji: null,
      titleNative: null,
      coverUrl: null,
      releaseYear: null,
      releaseMonth: null,
      releaseDay: null,
      scoreGlobal: null,
      genres: [],
    }]);
  });

  it('skips a row missing id or name instead of throwing', async () => {
    // Tauri's typed IgdbGame[] is a compile-time promise only; the JSON that
    // actually arrives can be anything.
    const rows = [{ id: 3 }, { name: 'No id' }, null, FULL_ROW] as unknown as typeof FULL_ROW[];
    searchMock.mockResolvedValue({ games: rows, hasMore: false });
    const { results } = await searchGames('x', 'game', signal());
    expect(results).toEqual([FULL_EXPECTED]);
  });

  it('labels a visual novel search with the vnovel type and format', async () => {
    searchMock.mockResolvedValue({ games: [{ id: 5, name: 'Steins;Gate' }], hasMore: false });
    const { results } = await searchGames('steins', 'vnovel', signal());
    expect(results[0]).toMatchObject({ externalId: 'vnovel:5', type: 'vnovel', format: 'VISUAL_NOVEL' });
  });
});

describe('searchGameBundles', () => {
  it('forces the BUNDLE format and drops a malformed row', async () => {
    const rows = [{ id: 8, name: 'Zelda Bundle', category: 3 }, { id: 9 }] as unknown as typeof FULL_ROW[];
    searchMock.mockResolvedValue({ games: rows, hasMore: false });
    const { results } = await searchGameBundles('zelda', signal());
    expect(results.map(r => [r.externalId, r.format])).toEqual([['game:8', 'BUNDLE']]);
  });
});
