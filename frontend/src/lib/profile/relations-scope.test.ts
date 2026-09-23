import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { DbMediaRelation } from '../tauri/catalog';

const { getMediaRelationsForIds } = vi.hoisted(() => ({
  getMediaRelationsForIds: vi.fn<(ids: string[], excludeTypes?: string[]) => Promise<DbMediaRelation[]>>(),
}));
vi.mock('../tauri/catalog', () => ({ getMediaRelationsForIds }));

const {
  collectSeedIds, collectRelationFrontier, mergeRelations, loadScopedMediaRelations, CHAIN_RELATION_TYPES,
} = await import('./relations-scope');

function rel(owner: string, target: string, type = 'SEQUEL'): DbMediaRelation {
  return { media_external_id: owner, related_media_external_id: target, relation_type: type, type_label: type, title: target };
}

describe('collectSeedIds', () => {
  it('unions library and catalog ids, library first, without duplicates or blanks', () => {
    const ids = collectSeedIds(
      [{ external_id: 'anime:1' }, { external_id: 'game:2' }, { external_id: '' }],
      [{ external_id: 'game:2' }, { external_id: 'manga:3' }, { external_id: 'anime:1' }],
    );
    expect(ids).toEqual(['anime:1', 'game:2', 'manga:3']);
  });
});

describe('collectRelationFrontier', () => {
  it('returns unknown ids on either end of chain-forming relations only', () => {
    const known = new Set(['anime:1']);
    const relations = [
      rel('anime:1', 'anime:2'),                 // SEQUEL -> follow
      rel('anime:0', 'anime:1', 'PREQUEL'),      // owner side unknown -> follow
      rel('game:9', 'anime:1', 'REMAKE'),        // edition edge -> follow
      rel('anime:1', 'anime:7', 'EPISODE'),      // bundle edge -> follow
      rel('anime:1', 'manga:5', 'ADAPTATION'),   // not a chain kind -> ignore
      rel('anime:1', 'anime:2'),                 // duplicate target
    ];
    expect(collectRelationFrontier(relations, known)).toEqual(['anime:2', 'anime:0', 'game:9', 'anime:7']);
  });

  it('follows every saga, edition and bundle kind', () => {
    for (const type of ['PREQUEL', 'SEQUEL', 'ALTERNATIVE', 'REMAKE', 'REMASTER', 'EXPANDED_GAME', 'EPISODE']) {
      expect(CHAIN_RELATION_TYPES.has(type)).toBe(true);
    }
    expect(CHAIN_RELATION_TYPES.has('RECOMMENDATION')).toBe(false);
  });
});

describe('mergeRelations', () => {
  it('appends only rows not already present, keeping the existing order', () => {
    const a = rel('anime:1', 'anime:2');
    const b = rel('anime:2', 'anime:1', 'PREQUEL');
    const c = rel('anime:2', 'anime:3');
    const merged = mergeRelations([a, b], [b, c, a]);
    expect(merged).toEqual([a, b, c]);
  });

  it('treats the same pair with a different type as a distinct row', () => {
    const merged = mergeRelations([rel('anime:1', 'anime:2')], [rel('anime:1', 'anime:2', 'ALTERNATIVE')]);
    expect(merged).toHaveLength(2);
  });
});

describe('loadScopedMediaRelations', () => {
  // Block body on purpose: mockReset() returns the mock, and a hook that
  // returns a function hands vitest a "cleanup" it would call with no args.
  beforeEach(() => { getMediaRelationsForIds.mockReset(); });

  it('walks the chain outwards until no new ids appear, excluding recommendations', async () => {
    // Library owns seasons 1 and 5; 2-4 are only reachable through the chain.
    const graph = [
      rel('anime:1', 'anime:2'), rel('anime:2', 'anime:3'), rel('anime:3', 'anime:4'), rel('anime:4', 'anime:5'),
      rel('anime:5', 'manga:50', 'ADAPTATION'), rel('manga:50', 'manga:51'),
    ];
    getMediaRelationsForIds.mockImplementation(async ids =>
      graph.filter(r => ids.includes(r.media_external_id ?? '') || ids.includes(r.related_media_external_id)),
    );

    const relations = await loadScopedMediaRelations(['anime:1', 'anime:5']);

    expect(relations).toEqual([
      rel('anime:1', 'anime:2'), rel('anime:4', 'anime:5'), rel('anime:5', 'manga:50', 'ADAPTATION'),
      rel('anime:2', 'anime:3'), rel('anime:3', 'anime:4'),
    ]);
    // Round 1: seeds. Round 2: the chain neighbours. Round 3: nothing new
    // beyond ids already known, so the loop stops without a fourth call.
    expect(getMediaRelationsForIds.mock.calls.map(([ids]) => ids)).toEqual([
      ['anime:1', 'anime:5'],
      ['anime:2', 'anime:4'],
      ['anime:3'],
    ]);
    for (const [, excludeTypes] of getMediaRelationsForIds.mock.calls) expect(excludeTypes).toEqual(['RECOMMENDATION']);
  });

  it('makes a single call when the direct edges close the graph', async () => {
    getMediaRelationsForIds.mockResolvedValue([rel('anime:1', 'anime:2'), rel('anime:2', 'anime:1', 'PREQUEL')]);
    const relations = await loadScopedMediaRelations(['anime:1', 'anime:2']);
    expect(relations).toHaveLength(2);
    expect(getMediaRelationsForIds).toHaveBeenCalledTimes(1);
  });

  it('returns nothing for no seeds without touching IPC, and what it has on a failed round', async () => {
    expect(await loadScopedMediaRelations([])).toEqual([]);
    expect(getMediaRelationsForIds).not.toHaveBeenCalled();

    getMediaRelationsForIds
      .mockResolvedValueOnce([rel('anime:1', 'anime:2')])
      .mockRejectedValueOnce(new Error('ipc down'));
    expect(await loadScopedMediaRelations(['anime:1'])).toEqual([rel('anime:1', 'anime:2')]);
  });
});
