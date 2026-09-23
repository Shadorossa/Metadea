import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaPageData } from './types';

vi.mock('../search/providers/anilist', () => ({
  fetchAniListDetail: vi.fn(),
  fetchAniListRemainingCharacters: vi.fn(),
}));
vi.mock('./mappers/anilist-mapper', () => ({
  mapAniListToMedia: vi.fn(),
  mapAniListCharacterEdges: vi.fn(),
}));
vi.mock('./mappers/igdb-mapper', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mappers/igdb-mapper')>()),
  mergeBaseGameRelation: vi.fn(),
  mergeRelationGraph: vi.fn(),
}));
vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  getBlockedExternalIds: vi.fn(async () => [] as string[]),
  igdbGetRelationGraph: vi.fn(async () => []),
  igdbGetBaseGames: vi.fn(async () => null),
}));

import { fetchAniListRemainingCharacters } from '../search/providers/anilist';
import { mapAniListCharacterEdges } from './mappers/anilist-mapper';
import { mergeBaseGameRelation, mergeRelationGraph } from './mappers/igdb-mapper';
import { getBlockedExternalIds, igdbGetBaseGames, igdbGetRelationGraph } from '../tauri';
import { fetchExtraCharacters, fetchExtraRelations } from './media-page-enrich';

const page = (externalId: string, extra: Partial<MediaPageData> = {}): MediaPageData => ({
  externalId, type: externalId.split(':')[0], titleMain: externalId, bannerColor: '',
  metaLines: [], stats: [], characters: [], relations: [], progressStatus: 'watching', progressLabel: '',
  ...extra,
});

beforeEach(() => { vi.clearAllMocks(); });

describe('fetchExtraCharacters', () => {
  it('does nothing unless the page flagged more characters', async () => {
    expect(await fetchExtraCharacters('anime:1', page('anime:1'))).toBeNull();
    expect(fetchAniListRemainingCharacters).not.toHaveBeenCalled();
  });

  it('only tops up AniList ids', async () => {
    expect(await fetchExtraCharacters('game:1', page('game:1', { charactersHasMore: true }))).toBeNull();
    expect(fetchAniListRemainingCharacters).not.toHaveBeenCalled();
  });

  it('appends the remaining pages after the characters already shown', async () => {
    const shown = [{ name: 'A' }];
    vi.mocked(fetchAniListRemainingCharacters).mockResolvedValue([{ id: 2 }] as never);
    vi.mocked(mapAniListCharacterEdges).mockReturnValue([{ name: 'B' }]);

    const result = await fetchExtraCharacters('anime:9', page('anime:9', { charactersHasMore: true, characters: shown }));
    expect(fetchAniListRemainingCharacters).toHaveBeenCalledWith(9, true);
    expect(result).toEqual([{ name: 'A' }, { name: 'B' }]);
  });

  it('returns null (not an empty list) when the extra fetch yields nothing', async () => {
    vi.mocked(fetchAniListRemainingCharacters).mockResolvedValue([]);
    expect(await fetchExtraCharacters('anime:9', page('anime:9', { charactersHasMore: true }))).toBeNull();
  });
});

describe('fetchExtraRelations', () => {
  const relation = (id: string) => ({ typeLabel: 'x', title: id, relatedExternalId: id });

  it('only walks the graph for IGDB ids', async () => {
    expect(await fetchExtraRelations('anime:1', page('anime:1'))).toBeNull();
    expect(igdbGetRelationGraph).not.toHaveBeenCalled();
  });

  it('asks for base games only for remakes/remasters, with the matching bucket', async () => {
    vi.mocked(mergeBaseGameRelation).mockImplementation(d => d);
    await fetchExtraRelations('game:1', page('game:1', { format: 'REMAKE' }));
    expect(igdbGetBaseGames).toHaveBeenCalledWith(1, 'remakes');
    await fetchExtraRelations('game:1', page('game:1', { format: 'REMASTER' }));
    expect(igdbGetBaseGames).toHaveBeenCalledWith(1, 'remasters');
    await fetchExtraRelations('game:1', page('game:1', { format: 'GAME' }));
    expect(igdbGetBaseGames).toHaveBeenCalledTimes(2);
  });

  it('returns null when the merged graph adds no relation', async () => {
    const current = page('game:1', { relations: [relation('game:2')] });
    vi.mocked(igdbGetRelationGraph).mockResolvedValue([{ id: 2 }] as never);
    vi.mocked(mergeRelationGraph).mockImplementation(d => d);
    expect(await fetchExtraRelations('game:1', current)).toBeNull();
    expect(mergeRelationGraph).toHaveBeenCalledWith(expect.objectContaining({ externalId: 'game:1' }), [{ id: 2 }], undefined);
  });

  it('passes IGDB game type 10 for expanded games', async () => {
    vi.mocked(igdbGetRelationGraph).mockResolvedValue([{ id: 2 }] as never);
    vi.mocked(mergeRelationGraph).mockImplementation(d => d);
    await fetchExtraRelations('game:1', page('game:1', { format: 'EXPANDED_GAME' }));
    expect(mergeRelationGraph).toHaveBeenCalledWith(expect.anything(), [{ id: 2 }], 10);
  });

  it('returns the new relations minus locally-blocked targets, or null if blocking removed all gains', async () => {
    const current = page('game:1', { relations: [relation('game:2')] });
    vi.mocked(igdbGetRelationGraph).mockResolvedValue([{ id: 3 }] as never);
    vi.mocked(mergeRelationGraph).mockImplementation(d => ({ ...d, relations: [...d.relations, relation('game:3')] }));

    expect(await fetchExtraRelations('game:1', current)).toEqual([relation('game:2'), relation('game:3')]);

    vi.mocked(getBlockedExternalIds).mockResolvedValue(['game:3']);
    expect(await fetchExtraRelations('game:1', current)).toBeNull();
  });
});
