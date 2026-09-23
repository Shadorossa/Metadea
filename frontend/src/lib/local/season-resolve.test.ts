import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbMediaRelation, MediaCatalogEntry } from '../tauri';
import { resolveOwnSeasonNumber, resolveSeasonExternalIds } from './season-resolve';

const mocks = vi.hoisted(() => ({
  getMediaRelationsForEditor: vi.fn(),
  getAnilistPreSequelChecked: vi.fn(),
  markAnilistPreSequelChecked: vi.fn(),
  getCatalogEntry: vi.fn(),
  graphqlPost: vi.fn(),
}));

vi.mock('../tauri', () => ({
  scanFolderContents: vi.fn(),
  getMediaRelationsForEditor: mocks.getMediaRelationsForEditor,
  getAnilistPreSequelChecked: mocks.getAnilistPreSequelChecked,
  markAnilistPreSequelChecked: mocks.markAnilistPreSequelChecked,
}));

vi.mock('../tauri/catalog', () => ({
  getCatalogEntry: mocks.getCatalogEntry,
}));

vi.mock('../api/client', () => ({
  graphqlPost: mocks.graphqlPost,
}));

type RelationsDb = Record<string, DbMediaRelation[]>;
type CatalogDb = Record<string, Partial<MediaCatalogEntry>>;

function relation(type: 'PREQUEL' | 'SEQUEL', relatedId: string, title: string): DbMediaRelation {
  return { related_media_external_id: relatedId, relation_type: type, type_label: type, title };
}

// Local DB is the primary source; AniList is only reached when it is empty.
function useLocalDb(relations: RelationsDb, catalog: CatalogDb = {}) {
  mocks.getMediaRelationsForEditor.mockImplementation(async (id: string) => relations[id] ?? []);
  mocks.getCatalogEntry.mockImplementation(async (id: string) => catalog[id] ?? null);
}

function anilistEdges(edges: { relationType: string; id: number; romaji?: string | null; english?: string | null; format?: string | null; episodes?: number | null }[]) {
  return {
    result: {
      data: {
        Media: {
          relations: {
            edges: edges.map(e => ({
              relationType: e.relationType,
              node: { id: e.id, format: e.format ?? null, episodes: e.episodes ?? null, title: { romaji: e.romaji ?? null, english: e.english ?? null } },
            })),
          },
        },
      },
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAnilistPreSequelChecked.mockResolvedValue(false);
  mocks.markAnilistPreSequelChecked.mockResolvedValue(undefined);
  mocks.graphqlPost.mockResolvedValue(anilistEdges([]));
  useLocalDb({});
});

describe('resolveOwnSeasonNumber', () => {
  it('falls back to the title marker when no prequel exists', async () => {
    await expect(resolveOwnSeasonNumber('tv:5', 'Show 2nd Season')).resolves.toBe(2);
    await expect(resolveOwnSeasonNumber('tv:5', 'Show')).resolves.toBeNull();
  });

  it('counts prequel hops back to the root', async () => {
    useLocalDb({
      'anime:3': [relation('PREQUEL', 'anime:2', 'The Big O II')],
      'anime:2': [relation('PREQUEL', 'anime:1', 'The Big O')],
    });
    await expect(resolveOwnSeasonNumber('anime:3', 'The Big O III')).resolves.toBe(3);
  });

  it('prefers the relation-derived ordinal over the title number', async () => {
    useLocalDb({ 'anime:2': [relation('PREQUEL', 'anime:1', 'Root')] });
    await expect(resolveOwnSeasonNumber('anime:2', 'Show 5')).resolves.toBe(2);
  });

  it('does not count a movie prequel and falls back to the title', async () => {
    useLocalDb(
      { 'anime:3': [relation('PREQUEL', 'anime:2', 'Movie')] },
      { 'anime:2': { format: 'MOVIE' } },
    );
    await expect(resolveOwnSeasonNumber('anime:3', 'Show')).resolves.toBeNull();
    await expect(resolveOwnSeasonNumber('anime:3', 'Show Season 2')).resolves.toBe(2);
  });

  it('ignores a one-episode special but counts a multi-episode one', async () => {
    useLocalDb(
      { 'anime:3': [relation('PREQUEL', 'anime:2', 'Special')] },
      { 'anime:2': { format: 'SPECIAL', total_count: 1 } },
    );
    await expect(resolveOwnSeasonNumber('anime:3', 'Show')).resolves.toBeNull();

    useLocalDb(
      { 'anime:3': [relation('PREQUEL', 'anime:2', 'Special')] },
      { 'anime:2': { format: 'special', total_count: 12 } },
    );
    await expect(resolveOwnSeasonNumber('anime:3', 'Show')).resolves.toBe(2);
  });

  it('stops on a cyclic prequel chain', async () => {
    useLocalDb({
      'anime:1': [relation('PREQUEL', 'anime:2', 'Two')],
      'anime:2': [relation('PREQUEL', 'anime:1', 'One')],
    });
    await expect(resolveOwnSeasonNumber('anime:1', 'One')).resolves.toBe(2);
  });

  it('caps the walk at six hops', async () => {
    const relations: RelationsDb = {};
    for (let i = 10; i > 1; i--) relations[`anime:${i}`] = [relation('PREQUEL', `anime:${i - 1}`, `S${i - 1}`)];
    useLocalDb(relations);
    await expect(resolveOwnSeasonNumber('anime:10', 'S10')).resolves.toBe(7);
  });

  it('asks AniList when the local DB has nothing and remembers a confirmed "no prequel"', async () => {
    mocks.graphqlPost.mockImplementation(async (_url: string, _query: string, vars: { id: number }) => {
      if (vars.id === 900) return anilistEdges([{ relationType: 'PREQUEL', id: 899, romaji: 'Root' }]);
      return anilistEdges([{ relationType: 'SEQUEL', id: 900 }]);
    });
    await expect(resolveOwnSeasonNumber('anime:900', 'Sequel')).resolves.toBe(2);
    expect(mocks.markAnilistPreSequelChecked).toHaveBeenCalledTimes(1);
    expect(mocks.markAnilistPreSequelChecked).toHaveBeenCalledWith('anime:899');
  });

  it('skips the AniList request when a "no prequel" was already recorded', async () => {
    mocks.getAnilistPreSequelChecked.mockResolvedValue(true);
    await expect(resolveOwnSeasonNumber('anime:910', 'Show 2')).resolves.toBe(2);
    expect(mocks.graphqlPost).not.toHaveBeenCalled();
  });

  it('treats a failed AniList request as no relations without recording anything', async () => {
    mocks.graphqlPost.mockRejectedValue(new Error('network'));
    await expect(resolveOwnSeasonNumber('anime:920', 'Show S3')).resolves.toBe(3);
    expect(mocks.markAnilistPreSequelChecked).not.toHaveBeenCalled();
  });

  it('never asks AniList for a non-anime/manga id', async () => {
    await expect(resolveOwnSeasonNumber('game:1', 'Game 2')).resolves.toBe(2);
    await expect(resolveOwnSeasonNumber('anime:notanumber', 'X')).resolves.toBeNull();
    expect(mocks.graphqlPost).not.toHaveBeenCalled();
  });

  it('falls through to AniList when the local relations call throws', async () => {
    mocks.getMediaRelationsForEditor.mockRejectedValue(new Error('db'));
    mocks.graphqlPost.mockResolvedValue(anilistEdges([]));
    await expect(resolveOwnSeasonNumber('anime:930', 'Show')).resolves.toBeNull();
    expect(mocks.graphqlPost).toHaveBeenCalledTimes(1);
  });
});

describe('resolveSeasonExternalIds', () => {
  it('maps a whole prequel/sequel chain around the given entry', async () => {
    useLocalDb(
      {
        'anime:2': [relation('PREQUEL', 'anime:1', 'Foo'), relation('SEQUEL', 'anime:3', 'Foo 3')],
        'anime:1': [relation('SEQUEL', 'anime:2', 'Foo 2')],
        'anime:3': [relation('PREQUEL', 'anime:2', 'Foo 2')],
      },
      {
        'anime:1': { title_main: 'Foo', title_native: 'フー', total_count: 13, format: 'TV' },
        'anime:3': { title_main: 'Foo 3', title_english: 'Foo Three', total_count: 12 },
      },
    );
    const map = await resolveSeasonExternalIds('anime:2', 'Foo 2', null);
    expect(map).toEqual({
      1: { externalId: 'anime:1', title: 'Foo', aliases: ['Foo', 'フー'], format: 'TV', totalCount: 13 },
      2: { externalId: 'anime:2', title: 'Foo 2', aliases: ['Foo 2'], format: undefined, totalCount: undefined },
      3: { externalId: 'anime:3', title: 'Foo 3', aliases: ['Foo 3', 'Foo Three'], format: undefined, totalCount: 12 },
    });
  });

  it('uses the given season when neither relations nor the title say otherwise', async () => {
    const map = await resolveSeasonExternalIds('anime:1', 'Foo', 4);
    expect(Object.keys(map)).toEqual(['4']);
    expect(map[4]).toMatchObject({ externalId: 'anime:1', title: 'Foo', aliases: ['Foo'] });
  });

  it('defaults to season 1 with nothing to go on', async () => {
    const map = await resolveSeasonExternalIds('anime:1', 'Foo', null);
    expect(Object.keys(map)).toEqual(['1']);
  });

  it('walks through a movie sequel without giving it a season number', async () => {
    useLocalDb(
      {
        'anime:1': [relation('SEQUEL', 'anime:9', 'Foo Movie')],
        'anime:9': [relation('SEQUEL', 'anime:2', 'Foo 2')],
      },
      { 'anime:9': { format: 'MOVIE' } },
    );
    const map = await resolveSeasonExternalIds('anime:1', 'Foo', null);
    expect(Object.keys(map)).toEqual(['1', '2']);
    expect(map[2].externalId).toBe('anime:2');
  });

  // The relation-derived ordinal (one real prequel = season 2) overrides
  // the caller's season, and the movie in between gets no slot of its own.
  it('walks backward through a movie prequel to the real season 1', async () => {
    useLocalDb(
      { 'anime:2': [relation('PREQUEL', 'anime:9', 'Foo Movie')], 'anime:9': [relation('PREQUEL', 'anime:1', 'Foo')] },
      { 'anime:9': { format: 'MOVIE' } },
    );
    const map = await resolveSeasonExternalIds('anime:2', 'Foo 2', 1);
    expect(Object.keys(map)).toEqual(['1', '2']);
    expect(map[1].externalId).toBe('anime:1');
  });

  it('stops when a relation loops back to an already-mapped entry', async () => {
    useLocalDb({
      'anime:1': [relation('SEQUEL', 'anime:2', 'Two')],
      'anime:2': [relation('SEQUEL', 'anime:1', 'One')],
    });
    const map = await resolveSeasonExternalIds('anime:1', 'One', null);
    expect(Object.keys(map)).toEqual(['1', '2']);
  });

  it('dedupes aliases and drops blank ones', async () => {
    useLocalDb({}, { 'anime:1': { title_main: 'Foo', title_romaji: 'Foo', title_english: '  ', title_native: null } });
    const map = await resolveSeasonExternalIds('anime:1', 'Foo', null);
    expect(map[1].aliases).toEqual(['Foo']);
  });
});
