import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HomeBundle } from '../tauri/home-bundle';

const getHomeBundle = vi.fn<() => Promise<HomeBundle | null>>();
const getAllLibraryEntries = vi.fn();
const getCatalogEntriesForLibrary = vi.fn();
const getCatalogEntriesByIds = vi.fn();
const getMediaRelationsForIds = vi.fn();
const getSagaNames = vi.fn();

vi.mock('../tauri/home-bundle', () => ({ getHomeBundle: (...args: unknown[]) => getHomeBundle(...args as []) }));
vi.mock('../tauri/library', () => ({ getAllLibraryEntries: () => getAllLibraryEntries() }));
vi.mock('../tauri/catalog', () => ({
  getCatalogEntriesForLibrary: () => getCatalogEntriesForLibrary(),
  getCatalogEntriesByIds: (ids: string[]) => getCatalogEntriesByIds(ids),
  getMediaRelationsForIds: (ids: string[], ex?: string[]) => getMediaRelationsForIds(ids, ex),
  getSagaNames: (ids: string[]) => getSagaNames(ids),
}));

const bundle: HomeBundle = {
  library: [{ external_id: 'anime:1' } as never],
  catalog: [{ external_id: 'anime:1' } as never, { external_id: 'anime:2' } as never],
  relations: [{ media_external_id: 'anime:1', related_media_external_id: 'anime:2', relation_type: 'SEQUEL', type_label: 'S', title: '' }],
  saga_names: { 'anime:1': 'Saga' },
};

async function fresh() {
  vi.resetModules();
  const cache = await import('../profile/library-data-cache');
  const home = await import('./home-data');
  return { ...cache, ...home };
}

beforeEach(() => {
  for (const fn of [getHomeBundle, getAllLibraryEntries, getCatalogEntriesForLibrary, getCatalogEntriesByIds, getMediaRelationsForIds, getSagaNames]) fn.mockReset();
});

describe('loadHomeData', () => {
  it('primes the shared profile cache from one bundle call', async () => {
    getHomeBundle.mockResolvedValue(bundle);
    const m = await fresh();
    const data = await m.loadHomeData();
    expect(data).toEqual({ items: bundle.library, catalog: bundle.catalog, relations: bundle.relations });
    expect(getHomeBundle).toHaveBeenCalledTimes(1);
    expect(getHomeBundle.mock.calls[0]).toEqual([{
      chainTypes: expect.arrayContaining(['SEQUEL', 'PREQUEL', 'ALTERNATIVE', 'REMAKE', 'REMASTER', 'EXPANDED_GAME', 'EPISODE']),
      excludeTypes: ['RECOMMENDATION'],
      maxHops: 8,
    }]);

    // Every other reader (profile tabs, calendar, notifications) is served
    // from that same load: no per-command chain, no second bundle.
    expect(await m.getCachedMediaRelations()).toBe(data.relations);
    expect((await m.getCachedLibraryAndCatalog()).items).toBe(data.items);
    expect(await m.loadHomeData()).toBe(data);
    expect(getHomeBundle).toHaveBeenCalledTimes(1);
    expect(getAllLibraryEntries).not.toHaveBeenCalled();
    expect(getMediaRelationsForIds).not.toHaveBeenCalled();

    // Saga names rode along — no get_saga_names.
    expect(await m.loadHomeSagaNames(data)).toEqual({ 'anime:1': 'Saga' });
    expect(getSagaNames).not.toHaveBeenCalled();
  });

  it('falls back to the per-command chain when the bundle is unavailable or fails', async () => {
    getHomeBundle.mockResolvedValue(null);
    getAllLibraryEntries.mockResolvedValue([{ external_id: 'anime:1' }]);
    getCatalogEntriesForLibrary.mockResolvedValue([{ external_id: 'anime:1' }]);
    getMediaRelationsForIds.mockResolvedValue([]);
    getSagaNames.mockResolvedValue({ 'anime:1': 'From command' });
    const m = await fresh();
    const data = await m.loadHomeData();
    expect(data.items).toEqual([{ external_id: 'anime:1' }]);
    expect(getAllLibraryEntries).toHaveBeenCalledTimes(1);
    expect(await m.loadHomeSagaNames(data)).toEqual({ 'anime:1': 'From command' });
    expect(getSagaNames).toHaveBeenCalledWith(['anime:1']);
    // The fallback load is what stays cached.
    expect(await m.loadHomeData()).toBe(data);
    expect(getAllLibraryEntries).toHaveBeenCalledTimes(1);

    getHomeBundle.mockRejectedValue(new Error('ipc'));
    const m2 = await fresh();
    expect((await m2.loadHomeData()).items).toEqual([{ external_id: 'anime:1' }]);
    expect(getAllLibraryEntries).toHaveBeenCalledTimes(2);
  });

  it('does not take over a cache that is already filled', async () => {
    getAllLibraryEntries.mockResolvedValue([]);
    getCatalogEntriesForLibrary.mockResolvedValue([]);
    getHomeBundle.mockResolvedValue(bundle);
    const m = await fresh();
    const chained = await m.getCachedLibraryAndCatalog();
    expect(chained.items).toEqual([]);
    const data = await m.loadHomeData();
    expect(data.items).toEqual([]);
    expect(getHomeBundle).not.toHaveBeenCalled();
  });
});
