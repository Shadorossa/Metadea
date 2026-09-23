import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaPageData } from './types';

// Provider + mapper boundaries: fetchMediaDataInternal's own job is only to
// pick the right pair from an external-id prefix and hand the result over.
vi.mock('../search/providers/anilist', () => ({
  fetchAniListDetail: vi.fn(),
  fetchAniListRemainingCharacters: vi.fn(),
}));
vi.mock('../search/providers/openlibrary', () => ({
  fetchOpenLibWork: vi.fn(),
  fetchOpenLibAuthor: vi.fn(),
  fetchOpenLibEditions: vi.fn(),
}));
vi.mock('../search/providers/tmdb', () => ({ fetchTmdbDetail: vi.fn() }));
vi.mock('../search/providers/comicvine', () => ({ fetchComicVineVolume: vi.fn() }));
vi.mock('../search/providers/apisports', () => ({ fetchApiSportsEvent: vi.fn() }));
vi.mock('./mappers/anilist-mapper', () => ({
  mapAniListToMedia: vi.fn(),
  mapAniListCharacterEdges: vi.fn(),
}));
vi.mock('./mappers/openlibrary-mapper', () => ({ mapOpenLibToMedia: vi.fn() }));
vi.mock('./mappers/comicvine-mapper', () => ({ mapComicVineToMedia: vi.fn() }));
vi.mock('./mappers/tmdb-mapper', () => ({ mapTmdbToMedia: vi.fn() }));
vi.mock('./mappers/igdb-mapper', () => ({
  mapIgdbToMedia: vi.fn(),
  dedupeRelationsByTarget: vi.fn((relations: unknown[]) => relations),
  mergeBaseGameRelation: vi.fn(),
  mergeRelationGraph: vi.fn(),
}));
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  getBlockedExternalIds: vi.fn(async () => [] as string[]),
  igdbGetGameDetail: vi.fn(),
}));

import { fetchAniListDetail } from '../search/providers/anilist';
import { fetchOpenLibWork, fetchOpenLibAuthor, fetchOpenLibEditions } from '../search/providers/openlibrary';
import { fetchTmdbDetail } from '../search/providers/tmdb';
import { fetchComicVineVolume } from '../search/providers/comicvine';
import { fetchApiSportsEvent } from '../search/providers/apisports';
import { mapAniListToMedia } from './mappers/anilist-mapper';
import { mapOpenLibToMedia } from './mappers/openlibrary-mapper';
import { mapComicVineToMedia } from './mappers/comicvine-mapper';
import { mapTmdbToMedia } from './mappers/tmdb-mapper';
import { mapIgdbToMedia, dedupeRelationsByTarget } from './mappers/igdb-mapper';
import { getBlockedExternalIds, igdbGetGameDetail } from '../tauri';
import { fetchMediaDataInternal, isAniListMediaType, isIgdbMediaType } from './media-page-fetch';

const page = (externalId: string): MediaPageData => ({
  externalId, type: externalId.split(':')[0], titleMain: externalId, bannerColor: '',
  metaLines: [], stats: [], characters: [], relations: [], progressStatus: 'watching', progressLabel: '',
});

const sessionStore = new Map<string, string>();
beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.clear();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => sessionStore.get(k) ?? null,
    setItem: (k: string, v: string) => { sessionStore.set(k, v); },
    removeItem: (k: string) => { sessionStore.delete(k); },
  });
});

describe('media type guards', () => {
  it('routes anime/manga/lnovel to AniList and game/vnovel to IGDB, nothing else', () => {
    expect(['anime', 'manga', 'lnovel'].every(isAniListMediaType)).toBe(true);
    expect(['game', 'vnovel'].every(isIgdbMediaType)).toBe(true);
    expect(['game', 'movie', 'book', ''].some(isAniListMediaType)).toBe(false);
    expect(['anime', 'series', 'comic', ''].some(isIgdbMediaType)).toBe(false);
  });
});

describe('fetchMediaDataInternal routing', () => {
  it('returns null for an empty id without touching any provider', async () => {
    expect(await fetchMediaDataInternal('')).toBeNull();
    expect(getBlockedExternalIds).not.toHaveBeenCalled();
  });

  it('refuses a locally-blocked id unless allowBlocked is set', async () => {
    vi.mocked(getBlockedExternalIds).mockResolvedValue(['anime:1']);
    vi.mocked(fetchAniListDetail).mockResolvedValue({} as never);
    vi.mocked(mapAniListToMedia).mockReturnValue(page('anime:1'));

    expect(await fetchMediaDataInternal('anime:1')).toBeNull();
    expect(fetchAniListDetail).not.toHaveBeenCalled();

    expect(await fetchMediaDataInternal('anime:1', true)).toEqual(page('anime:1'));
    expect(fetchAniListDetail).toHaveBeenCalledWith(1);
  });

  it('never resolves an issue sub-entry, whatever its parent prefix', async () => {
    for (const id of ['manga:issue-12', 'lnovel:issue-12', 'comic:issue-12']) {
      expect(await fetchMediaDataInternal(id)).toBeNull();
    }
    expect(fetchAniListDetail).not.toHaveBeenCalled();
    expect(fetchComicVineVolume).not.toHaveBeenCalled();
  });

  it('routes AniList prefixes through fetchAniListDetail + mapAniListToMedia with the bare type', async () => {
    const raw = { id: 918 };
    vi.mocked(fetchAniListDetail).mockResolvedValue(raw as never);
    vi.mocked(mapAniListToMedia).mockReturnValue(page('manga:918'));

    expect(await fetchMediaDataInternal('manga:918')).toEqual(page('manga:918'));
    expect(fetchAniListDetail).toHaveBeenCalledWith(918);
    expect(mapAniListToMedia).toHaveBeenCalledWith(raw, 'manga');
  });

  it('returns null when AniList has no detail, or when the id is not numeric', async () => {
    vi.mocked(fetchAniListDetail).mockResolvedValue(null);
    expect(await fetchMediaDataInternal('anime:5')).toBeNull();
    expect(await fetchMediaDataInternal('anime:abc')).toBeNull();
    expect(fetchAniListDetail).toHaveBeenCalledTimes(1);
  });

  it('routes IGDB prefixes through igdbGetGameDetail and dedupes the mapped relations', async () => {
    const game = { id: 7 };
    const mapped = { ...page('game:7'), relations: [{ typeLabel: 'x', title: 'a' }] };
    vi.mocked(igdbGetGameDetail).mockResolvedValue(game as never);
    vi.mocked(mapIgdbToMedia).mockReturnValue(mapped);

    const result = await fetchMediaDataInternal('vnovel:7');
    expect(igdbGetGameDetail).toHaveBeenCalledWith(7);
    expect(mapIgdbToMedia).toHaveBeenCalledWith(game, 'vnovel:7');
    expect(dedupeRelationsByTarget).toHaveBeenCalledWith(mapped.relations);
    expect(result?.relations).toEqual(mapped.relations);
  });

  it('routes movie/series through TMDB with the type and the full raw id', async () => {
    vi.mocked(fetchTmdbDetail).mockResolvedValue({ id: 5 } as never);
    vi.mocked(mapTmdbToMedia).mockReturnValue(page('series:5'));

    expect(await fetchMediaDataInternal('series:5')).toEqual(page('series:5'));
    expect(fetchTmdbDetail).toHaveBeenCalledWith(5, 'series');
    expect(mapTmdbToMedia).toHaveBeenCalledWith({ id: 5 }, 'series', 'series:5');
  });

  it('hands event ids straight to the API-Sports provider', async () => {
    vi.mocked(fetchApiSportsEvent).mockResolvedValue(page('event:apisports:football:39'));
    expect(await fetchMediaDataInternal('event:apisports:football:39')).toEqual(page('event:apisports:football:39'));
    expect(fetchApiSportsEvent).toHaveBeenCalledWith('event:apisports:football:39');
  });

  it('routes comics through ComicVine by numeric volume id', async () => {
    vi.mocked(fetchComicVineVolume).mockResolvedValue({ id: 99 } as never);
    vi.mocked(mapComicVineToMedia).mockReturnValue(page('comic:99'));

    expect(await fetchMediaDataInternal('comic:99')).toEqual(page('comic:99'));
    expect(fetchComicVineVolume).toHaveBeenCalledWith(99);
    expect(mapComicVineToMedia).toHaveBeenCalledWith({ id: 99 }, 'comic:99');
    expect(await fetchMediaDataInternal('comic:notanumber')).toBeNull();
  });

  it('builds every OpenLibrary co-author, and only fetches editions when the work has no cover', async () => {
    const work = { key: 'OL1W', authors: [{ author: { key: 'OL1A' } }, { author: { key: 'OL2A' } }], covers: [] };
    vi.mocked(fetchOpenLibWork).mockResolvedValue(work as never);
    vi.mocked(fetchOpenLibAuthor)
      .mockResolvedValueOnce({ key: 'OL1A', name: 'First', image: 'img1' })
      .mockResolvedValueOnce(null);
    vi.mocked(fetchOpenLibEditions).mockResolvedValue([{ covers: [42] }] as never);
    vi.mocked(mapOpenLibToMedia).mockReturnValue(page('book:OL1W'));

    await fetchMediaDataInternal('book:OL1W');
    expect(fetchOpenLibWork).toHaveBeenCalledWith('OL1W');
    expect(fetchOpenLibEditions).toHaveBeenCalledWith('OL1W');
    expect(mapOpenLibToMedia).toHaveBeenCalledWith(
      work,
      [{ external_id: 'author:OL1A', name: 'First', image: 'img1', url: '/author?id=author:OL1A' }],
      'book:OL1W',
      'book',
      42,
    );
  });

  it('falls back to the search result\'s cached author names when no author detail resolves', async () => {
    sessionStore.set('book_authors:book:OL2W', JSON.stringify(['Cached Author']));
    vi.mocked(fetchOpenLibWork).mockResolvedValue({ key: 'OL2W', authors: [], covers: [1] } as never);
    vi.mocked(mapOpenLibToMedia).mockReturnValue(page('book:OL2W'));

    await fetchMediaDataInternal('book:OL2W');
    expect(fetchOpenLibAuthor).not.toHaveBeenCalled();
    expect(fetchOpenLibEditions).not.toHaveBeenCalled();
    expect(mapOpenLibToMedia).toHaveBeenCalledWith(
      expect.anything(),
      [{ external_id: 'author:Cached Author', name: 'Cached Author' }],
      'book:OL2W',
      'book',
      undefined,
    );
  });

  it('returns null for an unknown prefix', async () => {
    expect(await fetchMediaDataInternal('podcast:1')).toBeNull();
  });
});
