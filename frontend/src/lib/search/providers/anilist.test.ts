import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SearchResult } from '../types';

// The network layer is the module boundary: graphqlPost is the only thing
// anilist.ts calls to reach AniList (it also owns the rate limiter, so
// mocking it keeps the tests free of timers).
vi.mock('../../api/client', () => ({ graphqlPost: vi.fn() }));
vi.mock('../../tauri/auth', () => ({ getAniListToken: () => null }));
vi.mock('../../storage/preferences', () => ({
  isAdultContentEnabled: () => false,
  isUnifySeasonsEnabled: () => false,
}));

import { graphqlPost } from '../../api/client';
import { searchAniList, searchAniListCharacters, searchAniListStaff } from './anilist';

const post = vi.mocked(graphqlPost);
const signal = () => new AbortController().signal;

function okPage(rows: unknown[], hasNextPage = false) {
  return { ok: true, status: 200, result: { data: { Page: { pageInfo: { hasNextPage }, media: rows } } } };
}

const EMPTY_PAGE = okPage([]);

// A realistic row exactly as AniList's search query returns it.
const FULL_ROW = {
  id: 21,
  format: 'TV',
  title: { romaji: 'ONE PIECE', native: 'ワンピース' },
  coverImage: { large: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21.jpg' },
  startDate: { year: 1999, month: 10, day: 20 },
  averageScore: 88,
  genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy'],
};

const FULL_EXPECTED: SearchResult = {
  externalId: 'anime:21',
  type: 'anime',
  format: 'TV',
  source: 'anilist',
  titleMain: 'ONE PIECE',
  titleRomaji: 'ONE PIECE',
  titleNative: 'ワンピース',
  coverUrl: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx21.jpg',
  releaseYear: 1999,
  releaseMonth: 10,
  releaseDay: 20,
  scoreGlobal: 8.8,
  genres: ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy'],
};

beforeEach(() => {
  post.mockReset();
});

describe('searchAniList', () => {
  it('maps a full AniList row to the exact SearchResult fields', async () => {
    post.mockResolvedValueOnce(okPage([FULL_ROW])).mockResolvedValueOnce(EMPTY_PAGE);
    const page = await searchAniList('one piece', 'ANIME', 'anime', signal());
    expect(page).toEqual({ results: [FULL_EXPECTED], hasMore: false });
  });

  it('still maps a row whose optional fields are null or absent', async () => {
    const sparse = {
      id: 7,
      format: null,
      title: { romaji: null, native: 'ネイティブ' },
      coverImage: null,
      startDate: null,
      averageScore: null,
      genres: null,
    };
    post.mockResolvedValueOnce(okPage([sparse])).mockResolvedValueOnce(EMPTY_PAGE);
    const { results } = await searchAniList('x', 'ANIME', 'anime', signal());
    expect(results).toEqual([{
      externalId: 'anime:7',
      type: 'anime',
      format: '',
      source: 'anilist',
      titleMain: 'ネイティブ',
      titleRomaji: null,
      titleNative: 'ネイティブ',
      coverUrl: null,
      releaseYear: null,
      releaseMonth: null,
      releaseDay: null,
      scoreGlobal: null,
      genres: [],
    }]);
  });

  it('skips a row missing a required field instead of throwing', async () => {
    const rows = [
      { id: 1 },                       // no title object at all
      { title: { romaji: 'No id' } },  // no id
      null,                            // not even an object
      'garbage',
      FULL_ROW,
    ];
    post.mockResolvedValueOnce(okPage(rows)).mockResolvedValueOnce(EMPTY_PAGE);
    const { results } = await searchAniList('x', 'ANIME', 'anime', signal());
    expect(results).toEqual([FULL_EXPECTED]);
  });

  it('drops NOVEL-format rows from a manga search', async () => {
    const novel = { ...FULL_ROW, id: 2, format: 'NOVEL' };
    post.mockResolvedValueOnce(okPage([FULL_ROW, novel])).mockResolvedValueOnce(EMPTY_PAGE);
    const { results } = await searchAniList('x', 'MANGA', 'manga', signal());
    expect(results.map(r => r.externalId)).toEqual(['manga:21']);
  });

  it('reports hasMore from whichever sub-page actually had results', async () => {
    post.mockResolvedValueOnce(okPage([FULL_ROW], true)).mockResolvedValueOnce(okPage([], true));
    const page = await searchAniList('x', 'ANIME', 'anime', signal());
    expect(page.hasMore).toBe(true);
  });

  it('returns an empty page when the response carries no Page object', async () => {
    post.mockResolvedValue({ ok: true, status: 200, result: { data: {} } });
    const page = await searchAniList('x', 'ANIME', 'anime', signal());
    expect(page).toEqual({ results: [], hasMore: false });
  });
});

describe('searchAniListCharacters', () => {
  it('maps a full character row and skips a malformed one', async () => {
    post.mockResolvedValueOnce({
      ok: true, status: 200,
      result: { data: { Page: { pageInfo: { hasNextPage: true }, characters: [
        { id: 40, name: { full: 'Luffy', native: 'ルフィ', alternative: ['Straw Hat', 'Mugiwara'] }, image: { large: 'https://img/luffy.jpg' } },
        { id: 41, name: { full: 'Bare', native: null, alternative: null }, image: null },
        { id: 42 },      // no name
        { name: { full: 'No id' } },
      ] } } },
    });
    const page = await searchAniListCharacters('luffy', signal());
    expect(page.hasMore).toBe(true);
    expect(page.results).toEqual([
      {
        externalId: 'character:a:40', type: 'character', format: '', source: 'anilist',
        titleMain: 'Luffy', titleRomaji: 'Straw Hat, Mugiwara', titleNative: 'ルフィ',
        coverUrl: 'https://img/luffy.jpg',
        releaseYear: null, releaseMonth: null, releaseDay: null, scoreGlobal: null, genres: [],
      },
      {
        externalId: 'character:a:41', type: 'character', format: '', source: 'anilist',
        titleMain: 'Bare', titleRomaji: null, titleNative: null, coverUrl: null,
        releaseYear: null, releaseMonth: null, releaseDay: null, scoreGlobal: null, genres: [],
      },
    ]);
  });
});

describe('searchAniListStaff', () => {
  it('maps a full staff row and skips a malformed one', async () => {
    post.mockResolvedValueOnce({
      ok: true, status: 200,
      result: { data: { Page: { pageInfo: { hasNextPage: false }, staff: [
        { id: 95, name: { full: 'Mayumi Tanaka', native: '田中真弓' }, image: { large: 'https://img/tanaka.jpg' } },
        { id: 96, name: { full: 'No image', native: null }, image: null },
        { id: 97, name: null },
      ] } } },
    });
    const page = await searchAniListStaff('tanaka', signal());
    expect(page).toEqual({
      results: [
        { id: 95, name: 'Mayumi Tanaka', nameNative: '田中真弓', image: 'https://img/tanaka.jpg' },
        { id: 96, name: 'No image', nameNative: null, image: null },
      ],
      hasMore: false,
    });
  });
});
