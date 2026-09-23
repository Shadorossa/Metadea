import { describe, it, expect } from 'vitest';
import type { DbMediaRelation } from '../../tauri/catalog';
import {
  classifySagaChain,
  createMetaResolver,
  filterToSequelChain,
  reconstructSagaOrder,
  topoSortByPrecedes,
} from './saga-grouping';

function rel(type: string, target: string, label = ''): DbMediaRelation {
  return { related_media_external_id: target, relation_type: type, type_label: label, title: target };
}

const byIndex = (ids: string[]) => (a: string, b: string) => ids.indexOf(a) - ids.indexOf(b);

describe('createMetaResolver', () => {
  const current = { title: 'Inazuma Eleven', cover: 'ie.png', release_year: 2008 };
  const resolve = createMetaResolver('anime:1', current, { 'anime:2': { title: 'IE 2', cover: null } });

  it('resolves the current entry to its own metadata', () => {
    expect(resolve('anime:1')).toBe(current);
  });

  it('resolves a known saga member from the map', () => {
    expect(resolve('anime:2')).toEqual({ title: 'IE 2', cover: null });
  });

  it('falls back to empty metadata for an unknown id', () => {
    expect(resolve('anime:99')).toEqual({ title: null, cover: null });
  });
});

describe('classifySagaChain', () => {
  it('returns nothing for an empty chain', () => {
    expect(classifySagaChain([], {}, {})).toEqual([]);
  });

  it('wraps a single ungrouped main entry as its own group', () => {
    expect(classifySagaChain(['anime:1'], {}, {})).toEqual([{ mainId: 'anime:1', ids: ['anime:1'], kind: 'group' }]);
  });

  it('collapses alternates sharing a group name, ignoring case and whitespace', () => {
    const entries = classifySagaChain(['a', 'b', 'c'], {}, { a: 'Remaster', b: ' remaster ', c: '' });
    expect(entries).toEqual([
      { mainId: 'a', ids: ['a', 'b'], kind: 'group' },
      { mainId: 'c', ids: ['c'], kind: 'group' },
    ]);
  });

  it('emits a cluster once, at its first member, even when members are not adjacent', () => {
    const entries = classifySagaChain(['a', 'x', 'b'], {}, { a: 'g', b: 'g' });
    expect(entries).toEqual([
      { mainId: 'a', ids: ['a', 'b'], kind: 'group' },
      { mainId: 'x', ids: ['x'], kind: 'group' },
    ]);
  });

  it('keeps source, episode and update entries standalone even with a group name', () => {
    const entries = classifySagaChain(['a', 's', 'e', 'u'], { s: 'source', e: 'episode', u: 'update' }, { a: 'g', s: 'g', e: 'g', u: 'g' });
    expect(entries).toEqual([
      { mainId: 'a', ids: ['a'], kind: 'group' },
      { mainId: 's', ids: ['s'], kind: 'source' },
      { mainId: 'e', ids: ['e'], kind: 'episode' },
      { mainId: 'u', ids: ['u'], kind: 'update' },
    ]);
  });

  it('treats a missing relation type as main', () => {
    expect(classifySagaChain(['a'], {}, { a: 'g' })).toEqual([{ mainId: 'a', ids: ['a'], kind: 'group' }]);
  });
});

describe('topoSortByPrecedes', () => {
  it('returns the ids as given when there are no edges', () => {
    const ids = ['b', 'a'];
    expect(topoSortByPrecedes(ids, new Map(), byIndex(ids))).toBe(ids);
  });

  it('orders ids by the edges and breaks ties with the callback', () => {
    const ids = ['c', 'b', 'a'];
    const precedes = new Map([['a', new Set(['b'])]]);
    expect(topoSortByPrecedes(ids, precedes, byIndex(ids))).toEqual(['c', 'a', 'b']);
  });

  it('falls back to the given order on a cycle', () => {
    const ids = ['a', 'b'];
    const precedes = new Map([['a', new Set(['b'])], ['b', new Set(['a'])]]);
    expect(topoSortByPrecedes(ids, precedes, byIndex(ids))).toBe(ids);
  });

  it('ignores an edge that points outside the id list', () => {
    const ids = ['a'];
    const precedes = new Map([['a', new Set(['z'])]]);
    expect(topoSortByPrecedes(ids, precedes, byIndex(ids))).toEqual(['a']);
  });

  it('keeps the manual order of the other members when one edge leaves the saga', () => {
    // release-date order c, b, a; manual order a -> b, plus a stray edge to
    // a removed member `z` and an edge from `z` back into the saga.
    const ids = ['c', 'b', 'a'];
    const precedes = new Map([['a', new Set(['b', 'z'])], ['z', new Set(['c'])]]);
    expect(topoSortByPrecedes(ids, precedes, byIndex(ids))).toEqual(['c', 'a', 'b']);
  });

  it('handles a single id', () => {
    expect(topoSortByPrecedes(['a'], new Map([['a', new Set<string>()]]), () => 0)).toEqual(['a']);
  });
});

describe('reconstructSagaOrder', () => {
  it('keeps release-date order when there are no edges', () => {
    const ids = ['anime:1', 'anime:2'];
    expect(reconstructSagaOrder(ids, [[], []])).toBe(ids);
  });

  it('follows a saved SEQUEL edge over release-date order', () => {
    expect(reconstructSagaOrder(['anime:2', 'anime:1'], [[], [rel('SEQUEL', 'anime:2')]])).toEqual(['anime:1', 'anime:2']);
  });

  it('counts a PREQUEL edge on the other row the same as a SEQUEL edge', () => {
    expect(reconstructSagaOrder(['anime:2', 'anime:1'], [[rel('PREQUEL', 'anime:1')], []])).toEqual(['anime:1', 'anime:2']);
  });

  it('understands the legacy Spanish relation labels', () => {
    expect(reconstructSagaOrder(['anime:2', 'anime:1'], [[], [rel('SECUELA', 'anime:2')]])).toEqual(['anime:1', 'anime:2']);
    expect(reconstructSagaOrder(['anime:2', 'anime:1'], [[rel('PRECUELA', 'anime:1')], []])).toEqual(['anime:1', 'anime:2']);
  });

  it('ignores edges to ids outside the saga and non-chronological relation types', () => {
    const ids = ['anime:2', 'anime:1'];
    expect(reconstructSagaOrder(ids, [[rel('SEQUEL', 'anime:99')], [rel('ADAPTATION', 'anime:2')]])).toBe(ids);
  });

  it('breaks ties between alternates by their saved in-group position', () => {
    const order = reconstructSagaOrder(
      ['a', 'b', 'c'],
      [[rel('ALTERNATIVE', 'b', 'Alternate #2')], [rel('ALTERNATIVE', 'a', 'Alternate #1')], [rel('PREQUEL', 'a')]],
    );
    expect(order).toEqual(['b', 'a', 'c']);
  });

  // Characterization: the in-group position only takes effect once at
  // least one SEQUEL/PREQUEL edge exists, since an empty edge set short-
  // circuits to release-date order.
  it('ignores in-group positions when the saga has no chronological edges at all', () => {
    const ids = ['a', 'b'];
    expect(reconstructSagaOrder(ids, [[rel('ALTERNATIVE', 'b', '#2')], [rel('ALTERNATIVE', 'a', '#1')]])).toBe(ids);
  });

  it('falls back to release-date order when the edges form a cycle', () => {
    const ids = ['anime:1', 'anime:2'];
    expect(reconstructSagaOrder(ids, [[rel('SEQUEL', 'anime:2')], [rel('SEQUEL', 'anime:1')]])).toBe(ids);
  });

  it('tolerates a missing relation list for an id', () => {
    expect(reconstructSagaOrder(['anime:2', 'anime:1'], [undefined as unknown as DbMediaRelation[], [rel('SEQUEL', 'anime:2')]])).toEqual(['anime:1', 'anime:2']);
  });
});

describe('filterToSequelChain', () => {
  it('keeps only ids reachable from the start through PREQUEL/SEQUEL edges', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const rels = [[rel('SEQUEL', 'b')], [rel('SEQUEL', 'c')], [], [rel('ALTERNATIVE', 'a')]];
    expect(filterToSequelChain(ids, rels, 'a')).toEqual(['a', 'b', 'c']);
  });

  it('walks edges in both directions regardless of which row stores them', () => {
    const ids = ['a', 'b'];
    expect(filterToSequelChain(ids, [[], [rel('PREQUEL', 'a')]], 'a')).toEqual(['a', 'b']);
  });

  it('ignores edges to ids outside the list', () => {
    expect(filterToSequelChain(['a'], [[rel('SEQUEL', 'z')]], 'a')).toEqual(['a']);
  });

  it('returns only the start id when it has no chronological edges', () => {
    expect(filterToSequelChain(['a', 'b'], [[], []], 'a')).toEqual(['a']);
  });

  it('returns nothing when the start id is not in the list', () => {
    expect(filterToSequelChain(['a', 'b'], [[rel('SEQUEL', 'b')], []], 'z')).toEqual([]);
  });

  it('preserves the original order of the surviving ids', () => {
    const ids = ['c', 'a', 'b'];
    const rels = [[rel('PREQUEL', 'b')], [rel('SEQUEL', 'b')], []];
    expect(filterToSequelChain(ids, rels, 'a')).toEqual(['c', 'a', 'b']);
  });
});
