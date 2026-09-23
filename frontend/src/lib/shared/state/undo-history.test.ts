import { describe, it, expect } from 'vitest';
import {
  COALESCE_WINDOW_MS, UNDO_HISTORY_LIMIT, canRedo, canUndo, createUndoHistory, recordUndoSnapshot, redoSnapshot, undoSnapshot,
} from './undo-history';

describe('undo-history', () => {
  it('starts empty with nothing to undo or redo', () => {
    const history = createUndoHistory<number>();
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undoSnapshot(history, 1)).toBeNull();
    expect(redoSnapshot(history, 1)).toBeNull();
  });

  it('records snapshots and walks back and forward through them', () => {
    let history = createUndoHistory<number>();
    history = recordUndoSnapshot(history, 1);
    history = recordUndoSnapshot(history, 2);
    expect(canUndo(history)).toBe(true);

    const undone = undoSnapshot(history, 3)!;
    expect(undone.snapshot).toBe(2);
    expect(canRedo(undone.history)).toBe(true);

    const undoneAgain = undoSnapshot(undone.history, undone.snapshot)!;
    expect(undoneAgain.snapshot).toBe(1);
    expect(canUndo(undoneAgain.history)).toBe(false);

    const redone = redoSnapshot(undoneAgain.history, undoneAgain.snapshot)!;
    expect(redone.snapshot).toBe(2);
    const redoneAgain = redoSnapshot(redone.history, redone.snapshot)!;
    expect(redoneAgain.snapshot).toBe(3);
    expect(canRedo(redoneAgain.history)).toBe(false);
  });

  it('a new edit after an undo discards the redo branch', () => {
    let history = recordUndoSnapshot(createUndoHistory<number>(), 1);
    history = undoSnapshot(history, 2)!.history;
    expect(canRedo(history)).toBe(true);
    history = recordUndoSnapshot(history, 1);
    expect(canRedo(history)).toBe(false);
  });

  it('keeps at most the limit, dropping the oldest snapshots', () => {
    let history = createUndoHistory<number>();
    for (let i = 0; i < UNDO_HISTORY_LIMIT + 10; i++) history = recordUndoSnapshot(history, i);
    expect(history.past).toHaveLength(UNDO_HISTORY_LIMIT);
    expect(history.past[0]).toBe(10);
    expect(history.past[history.past.length - 1]).toBe(UNDO_HISTORY_LIMIT + 9);
  });

  it('coalesces consecutive edits on the same key inside the window', () => {
    let history = createUndoHistory<string>();
    history = recordUndoSnapshot(history, '', { coalesceKey: 'title', at: 1000 });
    history = recordUndoSnapshot(history, 'a', { coalesceKey: 'title', at: 1200 });
    history = recordUndoSnapshot(history, 'ab', { coalesceKey: 'title', at: 1200 + COALESCE_WINDOW_MS });
    expect(history.past).toEqual(['']);

    // Past the window: a fresh step.
    history = recordUndoSnapshot(history, 'abc', { coalesceKey: 'title', at: 1200 + COALESCE_WINDOW_MS + COALESCE_WINDOW_MS + 1 });
    expect(history.past).toEqual(['', 'abc']);

    // A different field never merges, even inside the window.
    history = recordUndoSnapshot(history, 'abcd', { coalesceKey: 'synopsis', at: history.lastEdit!.at + 1 });
    expect(history.past).toEqual(['', 'abc', 'abcd']);

    // A non-text edit breaks the run so the next keystroke starts a new step.
    history = recordUndoSnapshot(history, 'x');
    history = recordUndoSnapshot(history, 'y', { coalesceKey: 'synopsis', at: history.lastEdit?.at ?? 0 });
    expect(history.past).toEqual(['', 'abc', 'abcd', 'x', 'y']);
  });

  it('undo/redo reset the coalescing window', () => {
    let history = recordUndoSnapshot(createUndoHistory<string>(), '', { coalesceKey: 'title', at: 10 });
    const step = undoSnapshot(history, 'a')!;
    expect(step.history.lastEdit).toBeNull();
    history = recordUndoSnapshot(step.history, '', { coalesceKey: 'title', at: 20 });
    expect(history.past).toEqual(['']);
    expect(history.future).toEqual([]);
  });
});
