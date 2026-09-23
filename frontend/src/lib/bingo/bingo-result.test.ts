import { describe, expect, it } from 'vitest';
import type { BingoCell } from '../tauri/yearly-bingo';
import {
  computeBingoResult,
  isDoneInYear,
  moveBingoCell,
  normalizeBingoCells,
  summarizeBingoCells,
  type BingoLibraryRow,
} from './bingo-result';

const cell = (id: string): BingoCell => ({ external_id: id, title: id, cover_url: null, media_type: id.split(':')[0] });
const row = (external_id: string, status: string | null, finished_at: string | null, rating: number | null = null): BingoLibraryRow =>
  ({ external_id, status, finished_at, rating });
const board = (size: number): BingoCell[] => Array.from({ length: size }, (_, i) => cell(`anime:${i}`));
const doneRows = (ids: number[]) => ids.map(i => row(`anime:${i}`, 'completed', '2027-05-01'));

describe('isDoneInYear', () => {
  it('needs completed status, and a finish date in the year when there is one', () => {
    expect(isDoneInYear(row('a:1', 'completed', '2027-03-01'), 2027)).toBe(true);
    expect(isDoneInYear(row('a:1', 'completed', '2027-12-31T22:00:00Z'), 2027)).toBe(true);
    expect(isDoneInYear(row('a:1', 'completed', '2026-12-25'), 2027)).toBe(false);
    expect(isDoneInYear(row('a:1', 'completed', null), 2027)).toBe(true);
    expect(isDoneInYear(row('a:1', 'completed', 'unknown'), 2027)).toBe(true);
    expect(isDoneInYear(row('a:1', 'watching', '2027-03-01'), 2027)).toBe(false);
    expect(isDoneInYear(undefined, 2027)).toBe(false);
  });
});

describe('computeBingoResult', () => {
  it('marks done cells, full lines, the percentage and scores on a 4×4 board', () => {
    // First row and the main diagonal.
    const library = doneRows([0, 1, 2, 3, 5, 10, 15]);
    library[0] = row('anime:0', 'completed', '2027-05-01', 8);
    library.push(row('anime:4', 'watching', null, 6));
    const result = computeBingoResult(board(16), library, 2027);
    expect(result.size).toBe(16);
    expect(result.done).toBe(7);
    expect(result.filled).toBe(16);
    expect(result.percent).toBe(44);
    expect(result.hasLines).toBe(true);
    expect(result.lines).toEqual([[0, 1, 2, 3], [0, 5, 10, 15]]);
    expect(result.cells[0]).toEqual({ done: true, rating: 8 });
    expect(result.cells[4]).toEqual({ done: false, rating: 6 });
    expect(result.cells[6]).toEqual({ done: false, rating: null });
  });

  it('computes the percentage over the board size and lines on any perfect square', () => {
    const nine = computeBingoResult(board(9), doneRows([2, 4, 6]), 2027);
    expect(nine).toMatchObject({ size: 9, done: 3, percent: 33, hasLines: true, lines: [[2, 4, 6]] });
    const one = computeBingoResult(board(1), doneRows([0]), 2027);
    expect(one).toMatchObject({ size: 1, done: 1, percent: 100, hasLines: true, lines: [[0]] });
  });

  it('has no bingo lines when the size is not a perfect square', () => {
    // 10 cells on a 4-column grid: a "full first row" is not a line.
    const result = computeBingoResult(board(10), doneRows([0, 1, 2, 3]), 2027);
    expect(result).toMatchObject({ size: 10, done: 4, percent: 40, hasLines: false, lines: [] });
    expect(result.cells).toHaveLength(10);
  });

  it('never counts empty cells, even in an otherwise full line', () => {
    const cells = normalizeBingoCells([cell('a:0'), cell('a:1'), cell('a:2')], 16);
    const library = ['a:0', 'a:1', 'a:2'].map(id => row(id, 'completed', null));
    const result = computeBingoResult(cells, library, 2027);
    expect(result.filled).toBe(3);
    expect(result.done).toBe(3);
    expect(result.lines).toEqual([]);
    expect(result.cells).toHaveLength(16);
  });
});

describe('summarizeBingoCells', () => {
  it('builds a result from synced per-cell flags, ignoring empty cells', () => {
    const cells = Array.from({ length: 4 }, (_, i) => ({ done: i !== 3, rating: i === 0 ? 9 : null }));
    const result = summarizeBingoCells(cells, [true, true, false, true]);
    expect(result).toMatchObject({ size: 4, done: 2, filled: 3, percent: 50, hasLines: true, lines: [[0, 1]] });
    expect(result.cells[2]).toEqual({ done: false, rating: null });
  });
});

describe('moveBingoCell', () => {
  it('moves one cell and shifts the rest', () => {
    expect(moveBingoCell(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveBingoCell(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveBingoCell(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});
