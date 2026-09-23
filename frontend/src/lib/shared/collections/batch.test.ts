import { describe, it, expect } from 'vitest';
import { groupByOwner, mapById } from './batch';

describe('groupByOwner', () => {
  it('buckets rows per id in the ids order, keeping row order and dropping foreign owners', () => {
    const rows = [
      { owner: 'b', n: 1 }, { owner: 'a', n: 2 }, { owner: 'zzz', n: 3 }, { owner: 'b', n: 4 }, { owner: undefined, n: 5 },
    ];
    const grouped = groupByOwner(rows, row => row.owner, ['a', 'b', 'c']);
    expect([...grouped.keys()]).toEqual(['a', 'b', 'c']);
    expect(grouped.get('a')?.map(r => r.n)).toEqual([2]);
    expect(grouped.get('b')?.map(r => r.n)).toEqual([1, 4]);
    expect(grouped.get('c')).toEqual([]);
  });

  it('returns an empty map for no ids', () => {
    expect(groupByOwner([{ owner: 'a' }], row => row.owner, []).size).toBe(0);
  });
});

describe('mapById', () => {
  it('keeps every id next to its loaded value', async () => {
    const map = await mapById(['x', 'y'], async id => id.toUpperCase());
    expect([...map.entries()]).toEqual([['x', 'X'], ['y', 'Y']]);
  });
});
