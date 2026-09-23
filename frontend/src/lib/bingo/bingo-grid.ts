// Yearly Bingo board shape, pure and tested (bingo-grid.test.ts). The owner
// picks how many works a board holds (1–49, default 16; yearly_bingo.rs
// enforces the same range). The grid has ceil(sqrt(size)) columns and as
// many rows as needed — an incomplete last row is centred by the CSS. Bingo
// lines (rows, columns, both diagonals) only exist on a perfect square
// board (1, 4, 9, …, 49); any other size just reports its percentage.
// The metadea-web Worker mirrors these rules for the public web profile.

export const DEFAULT_BINGO_SIZE = 16;
export const MIN_BINGO_SIZE = 1;
export const MAX_BINGO_SIZE = 49;

/** A whole number in [MIN_BINGO_SIZE, MAX_BINGO_SIZE]; anything else is DEFAULT_BINGO_SIZE. */
export function normalizeBingoSize(size: unknown): number {
  return typeof size === 'number' && Number.isInteger(size) && size >= MIN_BINGO_SIZE && size <= MAX_BINGO_SIZE
    ? size
    : DEFAULT_BINGO_SIZE;
}

/** Grid columns for `size` cells: ceil(sqrt(size)). */
export function bingoColumns(size: number): number {
  return Math.max(1, Math.ceil(Math.sqrt(size)));
}

/** Side of a perfect square board, or null (no bingo lines then). */
export function bingoSquareSide(size: number): number | null {
  const side = Math.round(Math.sqrt(size));
  return size >= 1 && side * side === size ? side : null;
}

/** Every row, column and diagonal of a perfect square board as cell
 *  indexes (rows, then columns, then diagonals; a 1×1 board has a single
 *  line); [] for any other size. */
export function bingoLines(size: number): number[][] {
  const side = bingoSquareSide(size);
  if (side === null) return [];
  const range = Array.from({ length: side }, (_, i) => i);
  const all = [
    ...range.map(r => range.map(c => r * side + c)),
    ...range.map(c => range.map(r => r * side + c)),
    range.map(i => i * side + i),
    range.map(i => i * side + (side - 1 - i)),
  ];
  const seen = new Set<string>();
  return all.filter(line => {
    const key = line.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** `cells` cut or padded (with `empty`) to exactly `size`: shrinking drops
 *  the trailing cells, growing appends empty ones. */
export function resizeBingoCells<T>(cells: readonly T[], size: number, empty: () => T): T[] {
  return Array.from({ length: size }, (_, i) => (i < cells.length ? cells[i] : empty()));
}

/** How many filled cells resizing to `size` would drop — the modal asks
 *  for confirmation when this is above 0. */
export function bingoCellsLostOnResize(cells: readonly unknown[], size: number): number {
  return cells.slice(size).filter(Boolean).length;
}
