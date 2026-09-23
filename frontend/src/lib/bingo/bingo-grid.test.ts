import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINGO_SIZE,
  bingoCellsLostOnResize,
  bingoColumns,
  bingoLines,
  bingoSquareSide,
  normalizeBingoSize,
  resizeBingoCells,
} from './bingo-grid';

describe('normalizeBingoSize', () => {
  it('keeps whole sizes from 1 to 49 and falls back to 16', () => {
    expect([1, 16, 49].map(normalizeBingoSize)).toEqual([1, 16, 49]);
    for (const bad of [0, 50, 2.5, -1, NaN, '16', null, undefined]) expect(normalizeBingoSize(bad)).toBe(DEFAULT_BINGO_SIZE);
  });
});

describe('bingoColumns', () => {
  it('uses ceil(sqrt(size)) columns', () => {
    expect([1, 2, 4, 5, 9, 10, 16, 17, 30, 49].map(bingoColumns)).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 6, 7]);
  });
});

describe('bingoLines', () => {
  it('only exists on perfect squares', () => {
    expect([1, 4, 9, 16, 25, 36, 49].map(bingoSquareSide)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const size of [2, 3, 5, 10, 15, 17, 48]) {
      expect(bingoSquareSide(size)).toBeNull();
      expect(bingoLines(size)).toEqual([]);
    }
  });

  it('lists rows, columns and both diagonals', () => {
    const four = bingoLines(16);
    expect(four).toHaveLength(10);
    expect(four[0]).toEqual([0, 1, 2, 3]);
    expect(four[4]).toEqual([0, 4, 8, 12]);
    expect(four[8]).toEqual([0, 5, 10, 15]);
    expect(four[9]).toEqual([3, 6, 9, 12]);
    expect(bingoLines(49)).toHaveLength(16);
    expect(bingoLines(4)).toEqual([[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]]);
    // A 1×1 board's row, column and diagonals are the same single line.
    expect(bingoLines(1)).toEqual([[0]]);
  });
});

describe('resizeBingoCells', () => {
  const empty = () => null;

  it('grows with empty cells and shrinks by dropping the trailing ones', () => {
    expect(resizeBingoCells(['a', 'b'], 4, empty)).toEqual(['a', 'b', null, null]);
    expect(resizeBingoCells(['a', null, 'c', 'd'], 2, empty)).toEqual(['a', null]);
  });

  it('counts the filled cells a shrink would drop', () => {
    expect(bingoCellsLostOnResize(['a', null, 'c', 'd'], 2)).toBe(2);
    expect(bingoCellsLostOnResize(['a', 'b', null, null], 2)).toBe(0);
    expect(bingoCellsLostOnResize(['a'], 9)).toBe(0);
  });
});
