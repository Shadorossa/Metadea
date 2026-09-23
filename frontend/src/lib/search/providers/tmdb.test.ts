import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResult } from '../types';

// fetchJson is the only network call tmdb.ts makes; readEnvConfig is the
// Tauri bridge that supplies the credentials.
vi.mock('../../api/client', () => ({ fetchJson: vi.fn() }));
vi.mock('../../tauri/env', () => ({ readEnvConfig: async () => ({ tmdb_api_key: 'test-key' }) }));

import { fetchJson } from '../../api/client';
import { searchMovies, searchSeries, findTmdbPersonExactMatch, parseDateParts } from './tmdb';

const fetchMock = vi.mocked(fetchJson);
const signal = () => new AbortController().signal;

// Exactly what TMDB's /search/movie returns for one hit.
const FULL_ROW = {
  id: 550,
  title: 'Fight Club',
  poster_path: '/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
  release_date: '1999-10-15',
  vote_average: 8.433,
  genre_ids: [18, 53],
  original_language: 'en',
};

const FULL_EXPECTED: SearchResult = {
  externalId: 'movie:550',
  type: 'movie',
  format: '',
  source: 'tmdb',
  titleMain: 'Fight Club',
  titleRomaji: null,
  titleNative: null,
  coverUrl: 'https://image.tmdb.org/t/p/w300/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg',
  releaseYear: 1999,
  releaseMonth: 10,
  releaseDay: 15,
  scoreGlobal: 8.4,
  genres: ['Drama', 'Thriller'],
};

beforeEach(() => {
  fetchMock.mockReset();
  // fetchTmdbPage fans out over 5 sub-pages; only the first carries data.
  fetchMock.mockResolvedValue(null);
});

describe('searchMovies', () => {
  it('maps a full TMDB row to the exact SearchResult fields', async () => {
    fetchMock.mockResolvedValueOnce({ results: [FULL_ROW], page: 1, total_pages: 3 });
    const page = await searchMovies('fight club', signal());
    expect(page).toEqual({ results: [FULL_EXPECTED], hasMore: true });
  });

  it('still maps a row whose optional fields are absent', async () => {
    fetchMock.mockResolvedValueOnce({ results: [{ id: 1, poster_path: null, vote_average: 0 }] });
    const { results, hasMore } = await searchMovies('x', signal());
    expect(hasMore).toBe(false);
    expect(results).toEqual([{
      externalId: 'movie:1',
      type: 'movie',
      format: '',
      source: 'tmdb',
      titleMain: '',
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

  it('skips a row missing its id (or not an object) instead of throwing', async () => {
    fetchMock.mockResolvedValueOnce({ results: [{ title: 'No id' }, null, 42, FULL_ROW] });
    const { results } = await searchMovies('x', signal());
    expect(results).toEqual([FULL_EXPECTED]);
  });

  it('excludes Japanese animation (handled by AniList)', async () => {
    const anime = { id: 2, title: 'Spirited Away', poster_path: null, vote_average: 8.5, genre_ids: [16, 10751], original_language: 'ja' };
    fetchMock.mockResolvedValueOnce({ results: [anime, FULL_ROW] });
    const { results } = await searchMovies('x', signal());
    expect(results.map(r => r.externalId)).toEqual(['movie:550']);
  });
});

describe('searchSeries', () => {
  it('uses the TV genre id space and first_air_date', async () => {
    fetchMock.mockResolvedValueOnce({ results: [
      { id: 1396, name: 'Breaking Bad', poster_path: '/bb.jpg', first_air_date: '2008-01-20', vote_average: 8.9, genre_ids: [18, 80], original_language: 'en' },
    ] });
    const { results } = await searchSeries('breaking bad', signal());
    expect(results).toEqual([{
      externalId: 'series:1396', type: 'series', format: '', source: 'tmdb',
      titleMain: 'Breaking Bad', titleRomaji: null, titleNative: null,
      coverUrl: 'https://image.tmdb.org/t/p/w300/bb.jpg',
      releaseYear: 2008, releaseMonth: 1, releaseDay: 20, scoreGlobal: 8.9,
      genres: ['Drama', 'Crime'],
    }]);
  });
});

describe('findTmdbPersonExactMatch', () => {
  it('ignores a person row without a name instead of throwing', async () => {
    fetchMock.mockResolvedValueOnce({ results: [
      { id: 1, profile_path: null },
      { id: 2, name: 'Brad Pitt', profile_path: '/bp.jpg', known_for_department: 'Acting', popularity: 50 },
    ] });
    const match = await findTmdbPersonExactMatch('brad pitt', signal());
    expect(match?.id).toBe(2);
  });
});

describe('parseDateParts', () => {
  it('reads YYYY-MM-DD in UTC and yields nulls for an empty string', () => {
    expect(parseDateParts('2020-12-31')).toEqual({ year: 2020, month: 12, day: 31 });
    expect(parseDateParts('')).toEqual({ year: null, month: null, day: null });
    expect(parseDateParts(undefined)).toEqual({ year: null, month: null, day: null });
  });
});
