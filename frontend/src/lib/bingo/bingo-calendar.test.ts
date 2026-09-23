import { describe, expect, it } from 'vitest';
import {
  bingoLockDate,
  editableBingoYear,
  homeBingoCards,
  isBingoEditable,
  isBingoResultPhase,
} from './bingo-calendar';

// Local dates, late in the day, so a UTC conversion would change the day.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 23, 30);
const morning = (y: number, m: number, d: number) => new Date(y, m - 1, d, 0, 5);

describe('edit window', () => {
  it('opens on Dec 20 for next year and closes after Jan 10', () => {
    expect(editableBingoYear(at(2026, 12, 19))).toBeNull();
    expect(editableBingoYear(morning(2026, 12, 20))).toBe(2027);
    expect(editableBingoYear(at(2026, 12, 31))).toBe(2027);
    expect(editableBingoYear(morning(2027, 1, 1))).toBe(2027);
    expect(editableBingoYear(at(2027, 1, 10))).toBe(2027);
    expect(editableBingoYear(morning(2027, 1, 11))).toBeNull();
    expect(editableBingoYear(at(2027, 6, 15))).toBeNull();
  });

  it('locks a board after Jan 10 of its year, and never edits the past one', () => {
    expect(isBingoEditable(2027, at(2027, 1, 10))).toBe(true);
    expect(isBingoEditable(2027, morning(2027, 1, 11))).toBe(false);
    expect(isBingoEditable(2026, at(2026, 12, 22))).toBe(false);
    expect(isBingoEditable(2027, at(2026, 12, 22))).toBe(true);
    expect(isBingoEditable(2028, at(2027, 6, 1))).toBe(false);
    const lock = bingoLockDate(2027);
    expect([lock.getFullYear(), lock.getMonth(), lock.getDate()]).toEqual([2027, 0, 10]);
  });
});

describe('result phase', () => {
  it('starts on Dec 19 of the board year and stays on afterwards', () => {
    expect(isBingoResultPhase(2027, at(2027, 12, 18))).toBe(false);
    expect(isBingoResultPhase(2027, morning(2027, 12, 19))).toBe(true);
    expect(isBingoResultPhase(2027, at(2027, 12, 31))).toBe(true);
    expect(isBingoResultPhase(2027, morning(2028, 1, 1))).toBe(true);
    expect(isBingoResultPhase(2027, at(2029, 3, 1))).toBe(true);
    expect(isBingoResultPhase(2027, at(2027, 1, 5))).toBe(false);
    expect(isBingoResultPhase(2027, at(2026, 12, 25))).toBe(false);
  });
});

describe('home cards', () => {
  it('shows the current board, view-only, outside Dec 19 – Jan 10', () => {
    expect(homeBingoCards(at(2027, 12, 18))).toEqual({ resultYear: null, editYear: null, viewYear: 2027 });
    expect(homeBingoCards(morning(2027, 1, 11))).toEqual({ resultYear: null, editYear: null, viewYear: 2027 });
    expect(homeBingoCards(at(2027, 7, 1))).toEqual({ resultYear: null, editYear: null, viewYear: 2027 });
  });

  it('Dec 19 shows only this year\'s result', () => {
    expect(homeBingoCards(morning(2027, 12, 19))).toEqual({ resultYear: 2027, editYear: null, viewYear: null });
  });

  it('Dec 20–31 shows this year\'s result and next year\'s board', () => {
    expect(homeBingoCards(morning(2026, 12, 20))).toEqual({ resultYear: 2026, editYear: 2027, viewYear: null });
    expect(homeBingoCards(at(2026, 12, 31))).toEqual({ resultYear: 2026, editYear: 2027, viewYear: null });
  });

  it('Jan 1–10 shows last year\'s result and this year\'s board (year rollover)', () => {
    expect(homeBingoCards(morning(2027, 1, 1))).toEqual({ resultYear: 2026, editYear: 2027, viewYear: null });
    expect(homeBingoCards(at(2027, 1, 10))).toEqual({ resultYear: 2026, editYear: 2027, viewYear: null });
  });

});
