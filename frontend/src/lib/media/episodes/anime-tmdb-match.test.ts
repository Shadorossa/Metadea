import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnimeChainRow } from '../../tauri/media-page';

vi.mock('../../search/providers/tmdb', () => ({
  searchTvIncludingAnime: vi.fn(async () => []),
  fetchTmdbDetail: vi.fn(async () => null),
}));
vi.mock('../media-page-read-cache', () => ({
  readCatalogEntryCached: vi.fn(async () => null),
  readAnimeChainCached: vi.fn(async () => [] as AnimeChainRow[]),
}));

import { readAnimeChainCached } from '../media-page-read-cache';
import { buildAnimeChain, getAnimePrequelEpisodeOffset, toChainEntry } from './anime-tmdb-match';

const row = (external_id: string, extra: Partial<AnimeChainRow> = {}): AnimeChainRow => ({
  external_id, title_main: `Main ${external_id}`, title_english: null, title_romaji: `Romaji ${external_id}`, title_native: null,
  total_count: 12, format: 'TV', release_year: 2010, status: 'FINISHED', ...extra,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('toChainEntry', () => {
  it('collects the distinct titles romaji-first and maps counts/format/year', () => {
    expect(toChainEntry(row('anime:1', { title_english: 'romaji anime:1', title_native: ' ', total_count: null, format: null, release_year: null }))).toEqual({
      externalId: 'anime:1',
      title: 'Romaji anime:1',
      titles: ['Romaji anime:1', 'Main anime:1'],
      totalCount: 0,
      format: undefined,
      releaseYear: undefined,
    });
  });
});

describe('buildAnimeChain', () => {
  it('maps the Rust chain rows in order', async () => {
    vi.mocked(readAnimeChainCached).mockResolvedValueOnce([row('anime:1'), row('anime:2', { format: 'MOVIE', total_count: 1 }), row('anime:3')]);
    const chain = await buildAnimeChain('anime:2');
    expect(chain.map(e => e.externalId)).toEqual(['anime:1', 'anime:2', 'anime:3']);
    expect(chain[1]).toMatchObject({ format: 'MOVIE', totalCount: 1, releaseYear: 2010 });
    expect(readAnimeChainCached).toHaveBeenCalledWith('anime:2');
  });

  it('never asks for a chain on a non-anime id, and is empty on a failed read', async () => {
    expect(await buildAnimeChain('game:5')).toEqual([]);
    expect(await buildAnimeChain('manga:5')).toEqual([]);
    expect(readAnimeChainCached).not.toHaveBeenCalled();
    vi.mocked(readAnimeChainCached).mockRejectedValueOnce(new Error('ipc'));
    expect(await buildAnimeChain('anime:5')).toEqual([]);
  });
});

describe('getAnimePrequelEpisodeOffset', () => {
  it('sums the TV episode counts of the prequels only (movies and one-off specials excluded)', async () => {
    vi.mocked(readAnimeChainCached).mockResolvedValue([
      row('anime:1', { total_count: 24 }),
      row('anime:2', { format: 'MOVIE', total_count: 1 }),
      row('anime:3', { format: 'SPECIAL', total_count: 1 }),
      row('anime:4', { format: 'SPECIAL', total_count: 2 }),
      row('anime:5', { total_count: 12 }),
      row('anime:6', { total_count: 13 }),
    ]);
    expect(await getAnimePrequelEpisodeOffset('anime:5')).toBe(26);
    expect(await getAnimePrequelEpisodeOffset('anime:1')).toBe(0);
    expect(await getAnimePrequelEpisodeOffset('anime:404')).toBe(0);
  });
});
