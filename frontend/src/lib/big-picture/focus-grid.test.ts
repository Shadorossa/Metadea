import { describe, expect, it } from 'vitest';
import { chunkRowLengths, clampFocus, indexToPos, moveFocus, posToIndex, samePos } from './focus-grid';

describe('chunkRowLengths', () => {
  it('lays cells out per row with a shorter last row', () => {
    expect(chunkRowLengths(11, 4)).toEqual([4, 4, 3]);
    expect(chunkRowLengths(8, 4)).toEqual([4, 4]);
  });

  it('handles empty grids and degenerate column counts', () => {
    expect(chunkRowLengths(0, 5)).toEqual([]);
    expect(chunkRowLengths(3, 0)).toEqual([1, 1, 1]);
  });
});

describe('indexToPos / posToIndex', () => {
  it('round-trips', () => {
    for (let i = 0; i < 20; i += 1) expect(posToIndex(indexToPos(i, 6), 6)).toBe(i);
    expect(indexToPos(13, 5)).toEqual({ row: 2, col: 3 });
  });
});

describe('moveFocus', () => {
  const grid = [4, 4, 2]; // 10 cells, 4 columns

  it('moves within a row and between rows', () => {
    expect(moveFocus(grid, { row: 0, col: 1 }, 'right')).toEqual({ row: 0, col: 2 });
    expect(moveFocus(grid, { row: 0, col: 1 }, 'down')).toEqual({ row: 1, col: 1 });
    expect(moveFocus(grid, { row: 1, col: 1 }, 'up')).toEqual({ row: 0, col: 1 });
  });

  it('stays put at the edges without wrapping', () => {
    expect(moveFocus(grid, { row: 0, col: 0 }, 'left')).toEqual({ row: 0, col: 0 });
    expect(moveFocus(grid, { row: 0, col: 3 }, 'right')).toEqual({ row: 0, col: 3 });
    expect(moveFocus(grid, { row: 0, col: 2 }, 'up')).toEqual({ row: 0, col: 2 });
    expect(moveFocus(grid, { row: 2, col: 1 }, 'down')).toEqual({ row: 2, col: 1 });
  });

  it('clamps the column when moving into a shorter row', () => {
    expect(moveFocus(grid, { row: 1, col: 3 }, 'down')).toEqual({ row: 2, col: 1 });
    // …and keeps it when moving back up out of it.
    expect(moveFocus(grid, { row: 2, col: 1 }, 'up')).toEqual({ row: 1, col: 1 });
  });

  it('wraps horizontally in reading order', () => {
    const wrap = { wrapHorizontal: true };
    expect(moveFocus(grid, { row: 0, col: 3 }, 'right', wrap)).toEqual({ row: 1, col: 0 });
    expect(moveFocus(grid, { row: 1, col: 0 }, 'left', wrap)).toEqual({ row: 0, col: 3 });
    expect(moveFocus(grid, { row: 2, col: 1 }, 'right', wrap)).toEqual({ row: 0, col: 0 });
    expect(moveFocus(grid, { row: 0, col: 0 }, 'left', wrap)).toEqual({ row: 2, col: 1 });
  });

  it('wraps vertically when asked', () => {
    const wrap = { wrapVertical: true };
    expect(moveFocus(grid, { row: 0, col: 3 }, 'up', wrap)).toEqual({ row: 2, col: 1 });
    expect(moveFocus(grid, { row: 2, col: 0 }, 'down', wrap)).toEqual({ row: 0, col: 0 });
  });

  it('skips empty rows', () => {
    expect(moveFocus([3, 0, 2], { row: 0, col: 2 }, 'down')).toEqual({ row: 2, col: 1 });
    expect(moveFocus([3, 0, 2], { row: 2, col: 0 }, 'up')).toEqual({ row: 0, col: 0 });
  });

  it('handles a single row and a single cell', () => {
    expect(moveFocus([1], { row: 0, col: 0 }, 'right', { wrapHorizontal: true })).toEqual({ row: 0, col: 0 });
    expect(moveFocus([5], { row: 0, col: 4 }, 'right', { wrapHorizontal: true })).toEqual({ row: 0, col: 0 });
    expect(moveFocus([5], { row: 0, col: 2 }, 'down', { wrapVertical: true })).toEqual({ row: 0, col: 2 });
  });

  it('returns the origin for an empty grid and clamps a stale position first', () => {
    expect(moveFocus([], { row: 3, col: 3 }, 'down')).toEqual({ row: 0, col: 0 });
    expect(moveFocus(grid, { row: 9, col: 9 }, 'left')).toEqual({ row: 2, col: 0 });
  });

  it('never mutates the input position', () => {
    const from = { row: 0, col: 0 };
    const to = moveFocus(grid, from, 'left');
    expect(to).not.toBe(from);
    expect(samePos(to, from)).toBe(true);
  });
});

describe('clampFocus', () => {
  it('pulls a position back into the grid', () => {
    expect(clampFocus([4, 2], { row: 1, col: 3 })).toEqual({ row: 1, col: 1 });
    expect(clampFocus([4, 2], { row: -1, col: -1 })).toEqual({ row: 0, col: 0 });
    expect(clampFocus([4, 0], { row: 1, col: 0 })).toEqual({ row: 0, col: 0 });
  });
});
