import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SagaEntry } from '../../anilist/saga';
import type { CatalogSummary, DbMediaRelation } from '../../tauri/catalog';

const catalogRows: Record<string, CatalogSummary> = {};
const relationRows: Record<string, DbMediaRelation[]> = {};
const transitiveIds: string[] = [];
let blocked: string[] = [];

const summary = (external_id: string, release_year: number, format = 'TV'): CatalogSummary => ({
  id: external_id, external_id, type: 'anime', format, status: 'FINISHED', title_main: `Title ${external_id}`,
  title_english: null, title_romaji: null, title_native: null, cover_url: `https://cdn/${external_id}.jpg`,
  release_day: 1, release_month: 1, release_year, total_count: 12, total_count_2: null, time_length: null,
  genres_csv: null, parent_id: null, updated_at: '',
});
const rel = (related: string, relation_type: string): DbMediaRelation => ({ related_media_external_id: related, relation_type, type_label: relation_type, title: '' });

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => [...transitiveIds]) }));
vi.mock('../../tauri', () => ({
  getCachedSaga: vi.fn(async () => null),
  saveCachedSaga: vi.fn(async () => {}),
  getSagaName: vi.fn(async () => 'Saga Name'),
}));
vi.mock('../../tauri/catalog', () => ({
  getCatalogEntriesByIds: vi.fn(async (ids: string[]) => ids.flatMap(id => catalogRows[id] ? [catalogRows[id]] : [])),
}));
vi.mock('../../tauri/story-arcs', () => ({
  getStoryArcsForMediaBatchLight: vi.fn(async () => [{ id: 'arc', name: 'Arc', image_base64: null, sort_order: 1, items: [{ id: 'i', media_external_id: 'anime:77', ep_start: null, ep_end: null, position: 0 }] }]),
}));
vi.mock('../media-page-read-cache', () => ({
  readBlockedExternalIdsCached: vi.fn(async () => blocked),
  readMediaRelationsBatchCached: vi.fn(async (ids: string[]) => new Map(ids.map(id => [id, relationRows[id] ?? []]))),
}));
vi.mock('../media-page-data', () => ({ fetchMediaData: vi.fn(async () => null) }));
vi.mock('../../anilist/saga', () => ({ fetchAniListSaga: vi.fn(async () => []) }));

import { getCatalogEntriesByIds } from '../../tauri/catalog';
import { readMediaRelationsBatchCached } from '../media-page-read-cache';
import { loadSagaChain, loadSagaArcs } from './saga-loader';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(catalogRows)) delete catalogRows[key];
  for (const key of Object.keys(relationRows)) delete relationRows[key];
  transitiveIds.length = 0;
  blocked = [];
});

describe('loadSagaChain (local reconstruction)', () => {
  it('orders the closure by saved SEQUEL/PREQUEL edges with two batched reads', async () => {
    // Closure comes back unordered; release dates disagree with the curated
    // edge order (anime:3 released first but is the sequel of anime:2).
    transitiveIds.push('anime:2', 'anime:3', 'anime:1', 'anime:8');
    catalogRows['anime:1'] = summary('anime:1', 2010);
    catalogRows['anime:2'] = summary('anime:2', 2012);
    catalogRows['anime:3'] = summary('anime:3', 2011);
    catalogRows['anime:8'] = summary('anime:8', 2013); // not linked by PREQUEL/SEQUEL: alternative version
    relationRows['anime:1'] = [rel('anime:2', 'SEQUEL')];
    relationRows['anime:2'] = [rel('anime:1', 'PREQUEL'), rel('anime:3', 'SEQUEL'), rel('anime:8', 'ALTERNATIVE')];
    relationRows['anime:3'] = [rel('anime:2', 'PREQUEL')];

    const chain = await loadSagaChain('anime:2');
    expect(chain.ok).toBe(true);
    expect(chain.sagaTitle).toBe('Saga Name');
    expect(chain.entries.map(e => e.externalId)).toEqual(['anime:1', 'anime:2', 'anime:3']);
    expect(chain.entries[0]).toEqual({
      externalId: 'anime:1', title: 'Title anime:1', cover: 'https://cdn/anime:1.jpg', format: 'TV', mediaType: 'anime',
      year: 2010, month: 1, day: 1,
    });
    expect(getCatalogEntriesByIds).toHaveBeenCalledTimes(1);
    expect(getCatalogEntriesByIds).toHaveBeenCalledWith(['anime:2', 'anime:3', 'anime:1', 'anime:8']);
    expect(readMediaRelationsBatchCached).toHaveBeenCalledTimes(1);
    // Relations are read in release-date order, as the per-id reads were.
    expect(readMediaRelationsBatchCached).toHaveBeenCalledWith(['anime:1', 'anime:3', 'anime:2', 'anime:8']);
  });

  it('drops blocked and SUMMARY members from the result only', async () => {
    transitiveIds.push('anime:1', 'anime:2', 'anime:3');
    catalogRows['anime:1'] = summary('anime:1', 2010);
    catalogRows['anime:2'] = summary('anime:2', 2011, 'SUMMARY');
    catalogRows['anime:3'] = summary('anime:3', 2012);
    relationRows['anime:1'] = [rel('anime:2', 'SEQUEL')];
    relationRows['anime:2'] = [rel('anime:3', 'SEQUEL')];
    blocked = ['anime:3'];
    const chain = await loadSagaChain('anime:1');
    expect(chain.entries.map(e => e.externalId)).toEqual(['anime:1']);
  });
});

describe('loadSagaArcs', () => {
  it('resolves arc items outside the chain with one batched catalog read', async () => {
    catalogRows['anime:77'] = summary('anime:77', 2015);
    const entries: SagaEntry[] = [{ externalId: 'anime:1', title: '', cover: null, format: null, mediaType: 'anime', year: null, month: null, day: null }];
    const { arcs, arcItemMeta } = await loadSagaArcs(entries);
    expect(arcs).toHaveLength(1);
    expect(arcItemMeta).toEqual({ 'anime:77': { title: 'Title anime:77', cover: 'https://cdn/anime:77.jpg' } });
    expect(getCatalogEntriesByIds).toHaveBeenCalledWith(['anime:77']);
  });
});
