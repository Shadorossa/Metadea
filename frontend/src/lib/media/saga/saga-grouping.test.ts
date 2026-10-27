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

// Expected marker: the function hands back the very same input array.
const SAME = Symbol('same');

function expectOrder(actual: string[], ids: string[], expected: string[] | typeof SAME) {
  if (expected === SAME) expect(actual).toBe(ids);
  else expect(actual).toEqual(expected);
}

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
  it.each<[string, string[], [string, string[]][], string[] | typeof SAME]>([
    ['returns the ids as given when there are no edges', ['b', 'a'], [], SAME],
    ['orders ids by the edges and breaks ties with the callback', ['c', 'b', 'a'], [['a', ['b']]], ['c', 'a', 'b']],
    ['falls back to the given order on a cycle', ['a', 'b'], [['a', ['b']], ['b', ['a']]], SAME],
    ['ignores an edge that points outside the id list', ['a'], [['a', ['z']]], ['a']],
    // release-date order c, b, a; manual order a -> b, plus a stray edge to
    // a removed member `z` and an edge from `z` back into the saga.
    ['keeps the manual order of the other members when one edge leaves the saga', ['c', 'b', 'a'], [['a', ['b', 'z']], ['z', ['c']]], ['c', 'a', 'b']],
    ['handles a single id', ['a'], [['a', []]], ['a']],
  ])('%s', (_name, ids, edges, expected) => {
    const precedes = new Map(edges.map(([from, to]) => [from, new Set(to)]));
    expectOrder(topoSortByPrecedes(ids, precedes, byIndex(ids)), ids, expected);
  });
});

describe('reconstructSagaOrder', () => {
  it.each<[string, string[], DbMediaRelation[][], string[] | typeof SAME]>([
    ['keeps release-date order when there are no edges', ['anime:1', 'anime:2'], [[], []], SAME],
    ['follows a saved SEQUEL edge over release-date order', ['anime:2', 'anime:1'], [[], [rel('SEQUEL', 'anime:2')]], ['anime:1', 'anime:2']],
    ['counts a PREQUEL edge on the other row the same as a SEQUEL edge', ['anime:2', 'anime:1'], [[rel('PREQUEL', 'anime:1')], []], ['anime:1', 'anime:2']],
    ['ignores edges to ids outside the saga and non-chronological relation types', ['anime:2', 'anime:1'], [[rel('SEQUEL', 'anime:99')], [rel('ADAPTATION', 'anime:2')]], SAME],
    ['breaks ties between alternates by their saved in-group position', ['a', 'b', 'c'],
      [[rel('ALTERNATIVE', 'b', 'Alternate #2')], [rel('ALTERNATIVE', 'a', 'Alternate #1')], [rel('PREQUEL', 'a')]], ['b', 'a', 'c']],
    // Characterization: the in-group position only takes effect once at
    // least one SEQUEL/PREQUEL edge exists, since an empty edge set short-
    // circuits to release-date order.
    ['ignores in-group positions when the saga has no chronological edges at all', ['a', 'b'], [[rel('ALTERNATIVE', 'b', '#2')], [rel('ALTERNATIVE', 'a', '#1')]], SAME],
    ['falls back to release-date order when the edges form a cycle', ['anime:1', 'anime:2'], [[rel('SEQUEL', 'anime:2')], [rel('SEQUEL', 'anime:1')]], SAME],
    ['tolerates a missing relation list for an id', ['anime:2', 'anime:1'], [undefined as unknown as DbMediaRelation[], [rel('SEQUEL', 'anime:2')]], ['anime:1', 'anime:2']],
  ])('%s', (_name, ids, rels, expected) => {
    expectOrder(reconstructSagaOrder(ids, rels), ids, expected);
  });
});

describe('filterToSequelChain', () => {
  it.each<[string, string[], DbMediaRelation[][], string, string[]]>([
    ['keeps only ids reachable from the start through PREQUEL/SEQUEL edges', ['a', 'b', 'c', 'd'],
      [[rel('SEQUEL', 'b')], [rel('SEQUEL', 'c')], [], [rel('ALTERNATIVE', 'a')]], 'a', ['a', 'b', 'c']],
    ['walks edges in both directions regardless of which row stores them', ['a', 'b'], [[], [rel('PREQUEL', 'a')]], 'a', ['a', 'b']],
    ['ignores edges to ids outside the list', ['a'], [[rel('SEQUEL', 'z')]], 'a', ['a']],
    ['returns only the start id when it has no chronological edges', ['a', 'b'], [[], []], 'a', ['a']],
    ['returns nothing when the start id is not in the list', ['a', 'b'], [[rel('SEQUEL', 'b')], []], 'z', []],
    ['preserves the original order of the surviving ids', ['c', 'a', 'b'], [[rel('PREQUEL', 'b')], [rel('SEQUEL', 'b')], []], 'a', ['c', 'a', 'b']],
  ])('%s', (_name, ids, rels, start, expected) => {
    expect(filterToSequelChain(ids, rels, start)).toEqual(expected);
  });
});
