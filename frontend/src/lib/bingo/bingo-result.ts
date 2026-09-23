// Yearly Bingo result, pure and tested (bingo-result.test.ts): which cells
// are done, which rows/columns/diagonals are full ("bingo lines", only on a
// perfect square board — see bingo-grid.ts), the completion percentage over
// the board's size and each work's library score. Inputs are the saved
// board and the cached library rows.
//
// A cell is done when its work's library entry is `completed` and, when the
// entry has a finish date, that date falls in the board's year (an entry
// completed without a date still counts).
import type { LibraryEntry } from '../tauri/library';
import type { BingoCell } from '../tauri/yearly-bingo';
import { bingoLines, bingoSquareSide } from './bingo-grid';

export type BingoLibraryRow = Pick<LibraryEntry, 'external_id' | 'status' | 'finished_at' | 'rating'>;

export interface BingoCellResult {
  done: boolean;
  /** The entry's score (DB 0–10 scale), null when unrated or not in the library. */
  rating: number | null;
}

export interface BingoResult {
  /** One per cell (the board's size). */
  cells: BingoCellResult[];
  /** Done cells. */
  done: number;
  /** Filled cells. */
  filled: number;
  /** Cells on the board (1–49). */
  size: number;
  /** done / size, 0–100, rounded. */
  percent: number;
  /** Whether the board is a perfect square, i.e. has bingo lines at all. */
  hasLines: boolean;
  /** Every full line as its cell indexes (rows, then columns, then
   *  diagonals); always [] when `hasLines` is false. */
  lines: number[][];
}

/** Year of a stored date ('YYYY-MM-DD' or ISO), or null when unreadable. */
function yearOf(date: string | null | undefined): number | null {
  const match = /^(\d{4})-\d{2}/.exec(date?.trim() ?? '');
  return match ? Number(match[1]) : null;
}

export function isDoneInYear(entry: BingoLibraryRow | undefined, year: number): boolean {
  if (!entry || entry.status !== 'completed') return false;
  const finished = yearOf(entry.finished_at);
  return finished === null || finished === year;
}

/** Pads/truncates to exactly `size` cells. */
export function normalizeBingoCells(cells: readonly BingoCell[], size: number): BingoCell[] {
  return Array.from({ length: size }, (_, i) => cells[i] ?? null);
}

/** Totals, percentage and full lines from per-cell results (the board's
 *  size is `cells.length`). An empty cell (`filled[i]` false) never counts. */
export function summarizeBingoCells(cells: readonly BingoCellResult[], filled: readonly boolean[]): BingoResult {
  const size = cells.length;
  const results = cells.map((cell, i) => (filled[i] ? cell : { done: false, rating: null }));
  const done = results.filter(r => r.done).length;
  return {
    cells: results,
    done,
    filled: filled.slice(0, size).filter(Boolean).length,
    size,
    percent: size > 0 ? Math.round((done / size) * 100) : 0,
    hasLines: bingoSquareSide(size) !== null,
    lines: bingoLines(size).filter(line => line.every(i => results[i].done)),
  };
}

/** The result of a board whose size is `cells.length`. */
export function computeBingoResult(cells: readonly BingoCell[], library: readonly BingoLibraryRow[], year: number): BingoResult {
  const byId = new Map(library.map(entry => [entry.external_id, entry]));
  const results = cells.map(cell => {
    if (!cell) return { done: false, rating: null };
    const entry = byId.get(cell.external_id);
    return { done: isDoneInYear(entry, year), rating: entry?.rating ? entry.rating : null };
  });
  return summarizeBingoCells(results, cells.map(Boolean));
}

/** Moves the cell at `from` to `to`, shifting the ones in between (the
 *  order a drag preview shows). */
export function moveBingoCell<T>(cells: readonly T[], from: number, to: number): T[] {
  const next = [...cells];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
