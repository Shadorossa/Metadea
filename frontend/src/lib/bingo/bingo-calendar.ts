// Yearly Bingo calendar rules, pure and tested (bingo-calendar.test.ts).
// Every rule reads the LOCAL calendar date of an injected `now`.
//
// - Edit window: Dec 20–31 prepares NEXT year's board, Jan 1–10 still edits
//   the CURRENT year's; from Jan 11 that board is read-only for good. UI-only
//   mirror of bingo_editable_year (yearly_bingo.rs), which enforces it.
// - Results: from Dec 19 of the board's year on, the board shows its result
//   (completed cells, bingo lines, scores).
// - Home: Dec 19 shows this year's result; Dec 20–31 this year's result and
//   next year's board; Jan 1–10 last year's result and this year's board;
//   any other day nothing.

/** December day the next year's board opens for editing. */
export const BINGO_OPEN_DAY = 20;
/** January day (inclusive) a board can last be edited on. */
export const BINGO_LOCK_DAY = 10;
/** December day a board starts showing its result. */
export const BINGO_RESULTS_DAY = 19;

const DECEMBER = 12;
const JANUARY = 1;

/** The year whose board may be created/edited on `now`, or null. */
export function editableBingoYear(now: Date): number | null {
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if (month === DECEMBER && day >= BINGO_OPEN_DAY) return now.getFullYear() + 1;
  if (month === JANUARY && day <= BINGO_LOCK_DAY) return now.getFullYear();
  return null;
}

export function isBingoEditable(year: number, now: Date): boolean {
  return editableBingoYear(now) === year;
}

/** Whether `year`'s board shows its result on `now` (from Dec 19 of `year`). */
export function isBingoResultPhase(year: number, now: Date): boolean {
  const current = now.getFullYear();
  if (current !== year) return current > year;
  return now.getMonth() + 1 === DECEMBER && now.getDate() >= BINGO_RESULTS_DAY;
}

/** Last local day `year`'s board can be edited on (Jan 10 of `year`). */
export function bingoLockDate(year: number): Date {
  return new Date(year, JANUARY - 1, BINGO_LOCK_DAY);
}

export interface HomeBingoCards {
  /** Board whose result Home shows, or null. */
  resultYear: number | null;
  /** Board Home offers to create/edit, or null. */
  editYear: number | null;
  /** The rest of the year: the current board, view-only with its progress so far. */
  viewYear: number | null;
}

export function homeBingoCards(now: Date): HomeBingoCards {
  const editYear = editableBingoYear(now);
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month === DECEMBER && now.getDate() >= BINGO_RESULTS_DAY) return { resultYear: year, editYear, viewYear: null };
  if (editYear !== null) return { resultYear: year - 1, editYear, viewYear: null };
  return { resultYear: null, editYear: null, viewYear: year };
}
