// Spatial focus over rows of cells for Big Picture mode — the carousel grid,
// the on-screen keyboard and the Start menu all move focus through this.
// A layout is just the length of each row, so rows of different length (the
// last row of a chunked grid, the keyboard's wide bottom row) are first-class.
// Pure and DOM-free: see focus-grid.test.ts.

export type FocusDirection = 'up' | 'down' | 'left' | 'right';

export interface GridPos {
  row: number;
  col: number;
}

export interface FocusMoveOptions {
  /** Left from a row's first cell lands on the previous row's last cell,
   *  right from its last cell on the next row's first (reading order). */
  wrapHorizontal?: boolean;
  /** Up from the first row lands on the last one and vice versa. */
  wrapVertical?: boolean;
}

/** Row lengths of `total` cells laid out `columns` per row. */
export function chunkRowLengths(total: number, columns: number): number[] {
  const perRow = Math.max(1, Math.floor(columns));
  const rows: number[] = [];
  for (let left = Math.max(0, Math.floor(total)); left > 0; left -= perRow) rows.push(Math.min(perRow, left));
  return rows;
}

export function indexToPos(index: number, columns: number): GridPos {
  const perRow = Math.max(1, Math.floor(columns));
  const safe = Math.max(0, Math.floor(index));
  return { row: Math.floor(safe / perRow), col: safe % perRow };
}

export function posToIndex(pos: GridPos, columns: number): number {
  return pos.row * Math.max(1, Math.floor(columns)) + pos.col;
}

function hasCells(rows: readonly number[]): boolean {
  return rows.some(length => length > 0);
}

/** Nearest valid position: the row clamped into range (skipping empty rows
 *  towards the start), the column clamped into that row. */
export function clampFocus(rows: readonly number[], pos: GridPos): GridPos {
  if (!hasCells(rows)) return { row: 0, col: 0 };
  let row = Math.min(Math.max(0, pos.row), rows.length - 1);
  while (row > 0 && rows[row] <= 0) row -= 1;
  while (rows[row] <= 0) row += 1;
  return { row, col: Math.min(Math.max(0, pos.col), rows[row] - 1) };
}

// Next non-empty row from `row` in `step` direction, or -1 past the edge.
function nextRow(rows: readonly number[], row: number, step: 1 | -1, wrap: boolean): number {
  for (let i = 1; i <= rows.length; i += 1) {
    let candidate = row + step * i;
    if (candidate < 0 || candidate >= rows.length) {
      if (!wrap) return -1;
      candidate = (candidate + rows.length * 2) % rows.length;
    }
    if (candidate === row) return -1;
    if (rows[candidate] > 0) return candidate;
  }
  return -1;
}

/** Where focus lands after one step in `direction`. At an edge without the
 *  matching wrap option focus stays put (same object values, new object). */
export function moveFocus(
  rows: readonly number[],
  from: GridPos,
  direction: FocusDirection,
  options: FocusMoveOptions = {},
): GridPos {
  if (!hasCells(rows)) return { row: 0, col: 0 };
  const pos = clampFocus(rows, from);
  const length = rows[pos.row];

  if (direction === 'left' || direction === 'right') {
    const step = direction === 'right' ? 1 : -1;
    const col = pos.col + step;
    if (col >= 0 && col < length) return { row: pos.row, col };
    if (!options.wrapHorizontal) return { ...pos };
    const target = nextRow(rows, pos.row, step, true);
    if (target === -1) return { row: pos.row, col: step === 1 ? 0 : length - 1 };
    return { row: target, col: step === 1 ? 0 : rows[target] - 1 };
  }

  const step = direction === 'down' ? 1 : -1;
  const target = nextRow(rows, pos.row, step, !!options.wrapVertical);
  if (target === -1) return { ...pos };
  // A shorter row keeps the column when it can, else its last cell.
  return { row: target, col: Math.min(pos.col, rows[target] - 1) };
}

export function samePos(a: GridPos, b: GridPos): boolean {
  return a.row === b.row && a.col === b.col;
}
