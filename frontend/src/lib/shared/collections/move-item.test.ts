import { describe, it, expect } from 'vitest';
import { moveItem } from './move-item';

describe('moveItem', () => {
  const list = ['a', 'b', 'c', 'd'];

  it('moves an item forward', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item backward', () => {
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('moves to the last position', () => {
    expect(moveItem(list, 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  // null tells the caller to skip the state update, so an inert drag never
  // triggers a re-render.
  it('returns null when the indices are the same', () => {
    expect(moveItem(list, 2, 2)).toBeNull();
  });

  it('returns null for out-of-range indices', () => {
    expect(moveItem(list, -1, 2)).toBeNull();
    expect(moveItem(list, 2, -1)).toBeNull();
    expect(moveItem(list, 4, 0)).toBeNull();
    expect(moveItem(list, 0, 4)).toBeNull();
  });

  it('returns null for any index into an empty list', () => {
    expect(moveItem([], 0, 1)).toBeNull();
  });

  it('does not mutate the source list', () => {
    const source = ['a', 'b', 'c'];
    moveItem(source, 0, 2);
    expect(source).toEqual(['a', 'b', 'c']);
  });

  it('preserves length and membership', () => {
    const out = moveItem(list, 1, 3)!;
    expect(out).toHaveLength(list.length);
    expect([...out].sort()).toEqual([...list].sort());
  });

  it('works on object items by reference', () => {
    const a = { id: 1 }, b = { id: 2 };
    const out = moveItem([a, b], 0, 1)!;
    expect(out[0]).toBe(b);
    expect(out[1]).toBe(a);
  });
});
