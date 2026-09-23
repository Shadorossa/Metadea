// A Yearly Bingo board as the shared share-image input (lib/share-image):
// the picks alone before the result phase, or with the result — completed
// cells, each one's score (formatted by the caller in the viewer's rating
// system), the percentage and the full lines (bingo-result.ts only finds
// lines on a perfect square board; the image hides them otherwise).
import type { BingoShareData } from '../share-image/share-image-types';
import type { BingoCell } from '../tauri/yearly-bingo';
import type { BingoResult } from './bingo-result';

export function bingoShareData(
  year: number,
  cells: readonly BingoCell[],
  result: BingoResult | null,
  formatScore: (rating: number) => string,
): BingoShareData {
  return {
    year,
    size: cells.length,
    cells: cells.map(cell => (cell
      ? { title: cell.title || cell.external_id, coverUrl: cell.cover_url || null, mediaType: cell.media_type }
      : null)),
    result: result
      ? {
        completed: cells.map((_, i) => result.cells[i]?.done === true),
        scores: cells.map((_, i) => {
          const rating = result.cells[i]?.rating;
          return rating != null && rating > 0 ? formatScore(rating) : null;
        }),
        percent: result.percent,
        lines: result.lines.length,
      }
      : undefined,
  };
}

/** Whether a board has anything to draw (at least one picked work). */
export function bingoHasPicks(cells: readonly BingoCell[]): boolean {
  return cells.some(Boolean);
}
