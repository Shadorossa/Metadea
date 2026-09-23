import { describe, expect, it } from 'vitest';
import type { BingoCell } from '../tauri/yearly-bingo';
import { computeBingoResult, type BingoLibraryRow } from './bingo-result';
import { bingoHasPicks, bingoShareData } from './bingo-share';

const cell = (id: string, cover: string | null = null): NonNullable<BingoCell> => ({ external_id: id, title: `T ${id}`, cover_url: cover, media_type: 'anime' });
const done = (id: string, rating: number | null = null): BingoLibraryRow => ({ external_id: id, status: 'completed', finished_at: '2026-06-01', rating });
const fmt = (r: number) => `${r / 2} / 5`;

describe('bingoShareData', () => {
  it('maps the picks without a result', () => {
    const data = bingoShareData(2026, [cell('a', 'https://img/a.jpg'), null, { ...cell('c'), title: '' }], null, fmt);
    expect(data).toEqual({
      year: 2026,
      size: 3,
      cells: [
        { title: 'T a', coverUrl: 'https://img/a.jpg', mediaType: 'anime' },
        null,
        { title: 'c', coverUrl: null, mediaType: 'anime' },
      ],
      result: undefined,
    });
  });

  it('carries completion, formatted scores, percent and lines of a square board', () => {
    const cells = [cell('a'), cell('b'), cell('c'), null];
    const result = computeBingoResult(cells, [done('a', 9), done('b'), { ...done('c', 7), status: 'watching' }], 2026);
    const data = bingoShareData(2026, cells, result, fmt);
    expect(data.result).toEqual({
      completed: [true, true, false, false],
      scores: ['4.5 / 5', null, '3.5 / 5', null],
      percent: 50,
      lines: 1,
    });
  });

  it('reports no lines on a non-square board', () => {
    const cells = [cell('a'), cell('b')];
    const result = computeBingoResult(cells, [done('a'), done('b')], 2026);
    expect(bingoShareData(2026, cells, result, fmt).result).toMatchObject({ percent: 100, lines: 0 });
  });

  it('knows when there is nothing to draw', () => {
    expect(bingoHasPicks([null, null])).toBe(false);
    expect(bingoHasPicks([null, cell('a')])).toBe(true);
  });
});
