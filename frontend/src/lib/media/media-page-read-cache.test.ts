import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MediaPageBundle } from '../tauri/media-page';

const bundleFixture = (): MediaPageBundle => ({
  catalog: { external_id: 'anime:1', title_main: 'From bundle' } as MediaPageBundle['catalog'],
  relations: [{ related_media_external_id: 'anime:2', relation_type: 'SEQUEL', type_label: 'Sequel', title: 'S2' }],
  authors: [{ external_id: 'author:1', name: 'A' }],
  characters: [{ external_id: 'character:1', name: 'C', image_url: 'https://asset.localhost/c.jpg' }],
  staff: [{ external_id: 'staff:1', name: 'S' }],
  companies: [{ external_id: 'company:1', name: 'Co', role: 'publisher' }],
  sync_state: { external_id: 'anime:1', last_synced_at: '2024-01-01' },
  library_entry: { external_id: 'anime:1', status: 'completed' } as MediaPageBundle['library_entry'],
  episodes: [{ external_id: 'anime:1', season_number: 0, episode_number: 1, name: 'Ep', cover_url: null }],
  themes: [{ external_id: 'anime:1', slug: 'OP1', theme_type: 'OP', sequence: 1, song_title: null, artists: null, episodes: null, video_url: null }],
});

vi.mock('../tauri', () => ({
  getCatalogEntry: vi.fn(async (externalId: string) => ({ external_id: externalId, title_main: 'From command' })),
  getMediaRelations: vi.fn(async (mediaExternalId: string) => [{ media_external_id: mediaExternalId }]),
  getMediaRelationsForIds: vi.fn(async (ids: string[]) => ids.flatMap(id => [
    { media_external_id: id, related_media_external_id: `${id}-a`, relation_type: 'SEQUEL', type_label: '', title: '' },
    { media_external_id: `${id}-a`, related_media_external_id: id, relation_type: 'PREQUEL', type_label: '', title: '' },
  ])),
  getBlockedExternalIds: vi.fn(async () => ['anime:9']),
  getMediaAuthors: vi.fn(async () => [{ external_id: 'author:cmd', name: 'cmd' }]),
  getMediaCharacters: vi.fn(async () => []),
  getMediaStaff: vi.fn(async () => []),
  getMediaCompanies: vi.fn(async () => []),
  getSyncState: vi.fn(async () => null),
  getLibraryEntry: vi.fn(async () => null),
  getMediaEpisodes: vi.fn(async () => [{ name: 'from command' }]),
  getMediaThemes: vi.fn(async () => []),
  getMediaPageBundle: vi.fn(async () => bundleFixture()),
  getAnimeChain: vi.fn(async (externalId: string) => [{ external_id: externalId }]),
}));

import * as tauri from '../tauri';
import {
  beginMediaPageVisit, endMediaPageVisit, invalidateMediaPageReads, isMediaPageVisitActive, markMediaPagePartStale,
  readCatalogEntryCached, readMediaRelationsCached, readBlockedExternalIdsCached, readMediaAuthorsCached,
  readMediaCharactersCached, readMediaStaffCached, readMediaCompaniesCached, readSyncStateCached,
  readLibraryEntryCached, readMediaEpisodesCached, readMediaThemesCached, readAnimeChainCached,
  readMediaRelationsBatchCached,
} from './media-page-read-cache';

const individualReads = [
  tauri.getCatalogEntry, tauri.getMediaRelations, tauri.getMediaAuthors, tauri.getMediaCharacters, tauri.getMediaStaff,
  tauri.getMediaCompanies, tauri.getSyncState, tauri.getLibraryEntry, tauri.getMediaEpisodes, tauri.getMediaThemes,
];
const individualCallCount = () => individualReads.reduce((sum, fn) => sum + vi.mocked(fn).mock.calls.length, 0);

async function readEveryPart(id: string) {
  return Promise.all([
    readCatalogEntryCached(id), readMediaRelationsCached(id), readMediaAuthorsCached(id), readMediaCharactersCached(id),
    readMediaStaffCached(id), readMediaCompaniesCached(id), readSyncStateCached(id), readLibraryEntryCached(id),
    readMediaEpisodesCached(id), readMediaThemesCached(id),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  endMediaPageVisit('anime:1');
  endMediaPageVisit('anime:2');
  invalidateMediaPageReads();
});

describe('media-page-read-cache', () => {
  it('passes every read straight through while no visit is active', async () => {
    expect(isMediaPageVisitActive()).toBe(false);
    await readEveryPart('anime:1');
    await readEveryPart('anime:1');
    await readBlockedExternalIdsCached();
    await readBlockedExternalIdsCached();
    await readAnimeChainCached('anime:1');
    await readAnimeChainCached('anime:1');
    expect(individualCallCount()).toBe(20);
    expect(tauri.getBlockedExternalIds).toHaveBeenCalledTimes(2);
    expect(tauri.getAnimeChain).toHaveBeenCalledTimes(2);
    expect(tauri.getMediaPageBundle).not.toHaveBeenCalled();
  });

  it("serves every part of the visit's own id from one bundle round trip", async () => {
    beginMediaPageVisit('anime:1');
    const [catalog, relations, authors, characters, staff, companies, syncState, libraryEntry, episodes, themes] = await readEveryPart('anime:1');
    await readEveryPart('anime:1');
    expect(tauri.getMediaPageBundle).toHaveBeenCalledTimes(1);
    expect(tauri.getMediaPageBundle).toHaveBeenCalledWith('anime:1');
    expect(individualCallCount()).toBe(0);
    const expected = bundleFixture();
    expect(catalog).toEqual(expected.catalog);
    expect(relations).toEqual(expected.relations);
    expect(authors).toEqual(expected.authors);
    expect(characters).toEqual(expected.characters);
    expect(staff).toEqual(expected.staff);
    expect(companies).toEqual(expected.companies);
    expect(syncState).toEqual(expected.sync_state);
    expect(libraryEntry).toEqual(expected.library_entry);
    expect(episodes).toEqual(expected.episodes);
    expect(themes).toEqual(expected.themes);
  });

  it('reads any other id through its own command, memoised for the visit', async () => {
    beginMediaPageVisit('anime:1');
    const [a, b] = await Promise.all([readCatalogEntryCached('anime:2'), readCatalogEntryCached('anime:2')]);
    await readMediaRelationsCached('anime:2');
    await readMediaRelationsCached('anime:2');
    expect(a).toBe(b);
    expect(a).toEqual({ external_id: 'anime:2', title_main: 'From command' });
    expect(tauri.getCatalogEntry).toHaveBeenCalledTimes(1);
    expect(tauri.getMediaRelations).toHaveBeenCalledTimes(1);
    expect(await readBlockedExternalIdsCached()).toEqual(['anime:9']);
    await readBlockedExternalIdsCached();
    expect(tauri.getBlockedExternalIds).toHaveBeenCalledTimes(1);
  });

  it('falls back to the individual commands when the bundle fails', async () => {
    vi.mocked(tauri.getMediaPageBundle).mockRejectedValueOnce(new Error('ipc'));
    beginMediaPageVisit('anime:1');
    const [catalog] = await readEveryPart('anime:1');
    expect(catalog).toEqual({ external_id: 'anime:1', title_main: 'From command' });
    expect(individualCallCount()).toBe(10);
    await readEveryPart('anime:1');
    expect(individualCallCount()).toBe(10);
  });

  it('re-reads only a part its writer marked stale', async () => {
    beginMediaPageVisit('anime:1');
    await readEveryPart('anime:1');
    markMediaPagePartStale('authors');
    markMediaPagePartStale('episodes');
    const authors = await readMediaAuthorsCached('anime:1');
    const episodes = await readMediaEpisodesCached('anime:1');
    const themes = await readMediaThemesCached('anime:1');
    expect(authors).toEqual([{ external_id: 'author:cmd', name: 'cmd' }]);
    expect(episodes).toEqual([{ name: 'from command' }]);
    expect(themes).toEqual(bundleFixture().themes);
    expect(tauri.getMediaAuthors).toHaveBeenCalledTimes(1);
    expect(tauri.getMediaEpisodes).toHaveBeenCalledTimes(1);
    expect(tauri.getMediaThemes).not.toHaveBeenCalled();
    expect(tauri.getMediaPageBundle).toHaveBeenCalledTimes(1);
  });

  it('fetches a fresh bundle once after invalidation, and starts a new visit empty', async () => {
    beginMediaPageVisit('anime:1');
    await readCatalogEntryCached('anime:1');
    invalidateMediaPageReads();
    await Promise.all([readCatalogEntryCached('anime:1'), readMediaEpisodesCached('anime:1')]);
    expect(tauri.getMediaPageBundle).toHaveBeenCalledTimes(2);
    beginMediaPageVisit('anime:2');
    expect(await readCatalogEntryCached('anime:1')).toEqual({ external_id: 'anime:1', title_main: 'From command' });
    expect(tauri.getMediaPageBundle).toHaveBeenCalledTimes(3);
    expect(tauri.getMediaPageBundle).toHaveBeenLastCalledWith('anime:2');
  });

  it('only the visit that is still active can end the memo', async () => {
    beginMediaPageVisit('anime:2');
    endMediaPageVisit('anime:1');
    expect(isMediaPageVisitActive()).toBe(true);
    endMediaPageVisit('anime:2');
    expect(isMediaPageVisitActive()).toBe(false);
  });

  it('does not retain a rejected read', async () => {
    beginMediaPageVisit('anime:1');
    vi.mocked(tauri.getMediaRelations).mockRejectedValueOnce(new Error('ipc'));
    await expect(readMediaRelationsCached('anime:2')).rejects.toThrow('ipc');
    expect(await readMediaRelationsCached('anime:2')).toEqual([{ media_external_id: 'anime:2' }]);
    expect(tauri.getMediaRelations).toHaveBeenCalledTimes(2);
  });

  it('memoises the anime chain per id for the visit', async () => {
    beginMediaPageVisit('anime:1');
    await readAnimeChainCached('anime:1');
    await readAnimeChainCached('anime:1');
    await readAnimeChainCached('anime:2');
    expect(tauri.getAnimeChain).toHaveBeenCalledTimes(2);
    invalidateMediaPageReads();
    await readAnimeChainCached('anime:1');
    expect(tauri.getAnimeChain).toHaveBeenCalledTimes(3);
  });

  describe('readMediaRelationsBatchCached', () => {
    it('batches the ids the visit has not memoised, in ids order, and seeds the per-id memo', async () => {
      beginMediaPageVisit('anime:1');
      const rows = await readMediaRelationsBatchCached(['anime:3', 'anime:1', 'anime:2', 'anime:3']);
      expect([...rows.keys()]).toEqual(['anime:3', 'anime:1', 'anime:2']);
      expect(rows.get('anime:1')).toEqual(bundleFixture().relations);
      expect(rows.get('anime:2')?.map(r => r.related_media_external_id)).toEqual(['anime:2-a']);
      expect(rows.get('anime:3')?.map(r => r.related_media_external_id)).toEqual(['anime:3-a']);
      expect(tauri.getMediaRelationsForIds).toHaveBeenCalledTimes(1);
      expect(tauri.getMediaRelationsForIds).toHaveBeenCalledWith(['anime:3', 'anime:2']);
      expect(await readMediaRelationsCached('anime:2')).toBe(rows.get('anime:2'));
      expect(tauri.getMediaRelations).not.toHaveBeenCalled();
      // Already-memoised ids are not batched again.
      await readMediaRelationsBatchCached(['anime:2', 'anime:3']);
      expect(tauri.getMediaRelationsForIds).toHaveBeenCalledTimes(1);
    });

    it('is a plain batch outside a visit and resolves failed ids to []', async () => {
      const rows = await readMediaRelationsBatchCached(['anime:5']);
      expect(rows.get('anime:5')?.length).toBe(1);
      vi.mocked(tauri.getMediaRelationsForIds).mockRejectedValueOnce(new Error('ipc'));
      beginMediaPageVisit('anime:1');
      expect((await readMediaRelationsBatchCached(['anime:6'])).get('anime:6')).toEqual([]);
      // Nothing retained: the next read hits the command again.
      await readMediaRelationsCached('anime:6');
      expect(tauri.getMediaRelations).toHaveBeenCalledTimes(1);
    });
  });
});
