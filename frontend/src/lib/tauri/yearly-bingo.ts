// Yearly Bingo — yearly_bingo.rs. Only the board crosses IPC (its size and
// one snapshot of the picked work per cell); results are computed from the
// cached library in lib/bingo/bingo-result.ts.
import { invoke, tauriCmd } from './bridge';

export interface BingoItem {
  external_id: string;
  title: string;
  cover_url: string | null;
  media_type: string;
}

/** null = empty cell. */
export type BingoCell = BingoItem | null;

export interface YearlyBingoData {
  year: number;
  /** Number of cells the owner picked, 1–49 (boards saved before sizes existed read as 16). */
  size: number;
  /** Exactly `size` cells, in grid order. */
  items: BingoCell[];
  /** Unix seconds. */
  created_at: number;
  updated_at: number;
}

/** `year`'s board, or null when none was saved. Rejects on an IPC/DB error
 *  so the UI never offers to overwrite a board it could not read. Outside
 *  Tauri: null. */
export function getYearlyBingo(year: number): Promise<YearlyBingoData | null> {
  return tauriCmd<YearlyBingoData | null>('get_yearly_bingo', null, { year });
}

/** Replaces `year`'s board (all cells empty deletes it). `items` must hold
 *  exactly `size` (1–49) cells, else E_BINGO_INVALID; Rust rejects it with
 *  E_BINGO_LOCKED outside the Dec 20 – Jan 10 edit window. */
export function setYearlyBingo(year: number, size: number, items: BingoCell[]): Promise<void> {
  return invoke<void>('set_yearly_bingo', { year, size, items });
}
