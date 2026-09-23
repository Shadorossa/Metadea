// Bounded undo/redo history for a reducer's editable draft — pure so both
// editor reducers (pr-editor-state.ts, library-log-state.ts) share one
// tested implementation and only decide *what* a snapshot is.
//
// `record` is called with the draft as it was *before* a draft-changing
// action; undo/redo swap the present draft with the stacks. Consecutive
// edits carrying the same `coalesceKey` within COALESCE_WINDOW_MS collapse
// into one history entry, so typing a word into a field is one undo step
// instead of one per keystroke.

export const UNDO_HISTORY_LIMIT = 50;
export const COALESCE_WINDOW_MS = 500;

export interface UndoHistory<T> {
  past: T[];
  future: T[];
  /** Last recorded coalescable edit, to merge a fast follow-up into it. */
  lastEdit: { key: string; at: number } | null;
}

export interface RecordOptions {
  /** Identifies a text field: same key within the window = same undo step. */
  coalesceKey?: string;
  /** Timestamp of the edit (ms); only read when `coalesceKey` is set. */
  at?: number;
}

export function createUndoHistory<T>(): UndoHistory<T> {
  return { past: [], future: [], lastEdit: null };
}

export function canUndo<T>(history: UndoHistory<T>): boolean { return history.past.length > 0; }
export function canRedo<T>(history: UndoHistory<T>): boolean { return history.future.length > 0; }

/** Pushes `previous` (the draft before the change) and clears redo. */
export function recordUndoSnapshot<T>(history: UndoHistory<T>, previous: T, options: RecordOptions = {}): UndoHistory<T> {
  const { coalesceKey, at = 0 } = options;
  if (coalesceKey !== undefined) {
    const last = history.lastEdit;
    if (last && last.key === coalesceKey && at - last.at <= COALESCE_WINDOW_MS && history.past.length > 0) {
      // Same field, still typing: keep the snapshot taken before the first
      // keystroke, just extend the window (and drop any redo branch).
      return { past: history.past, future: [], lastEdit: { key: coalesceKey, at } };
    }
  }
  const past = history.past.length >= UNDO_HISTORY_LIMIT
    ? [...history.past.slice(history.past.length - UNDO_HISTORY_LIMIT + 1), previous]
    : [...history.past, previous];
  return { past, future: [], lastEdit: coalesceKey !== undefined ? { key: coalesceKey, at } : null };
}

export interface UndoStep<T> {
  history: UndoHistory<T>;
  /** The draft to make current. */
  snapshot: T;
}

/** Moves one step back; `null` when there is nothing to undo. */
export function undoSnapshot<T>(history: UndoHistory<T>, present: T): UndoStep<T> | null {
  if (history.past.length === 0) return null;
  const snapshot = history.past[history.past.length - 1];
  return {
    snapshot,
    history: { past: history.past.slice(0, -1), future: [...history.future, present], lastEdit: null },
  };
}

/** Moves one step forward; `null` when there is nothing to redo. */
export function redoSnapshot<T>(history: UndoHistory<T>, present: T): UndoStep<T> | null {
  if (history.future.length === 0) return null;
  const snapshot = history.future[history.future.length - 1];
  return {
    snapshot,
    history: { past: [...history.past, present], future: history.future.slice(0, -1), lastEdit: null },
  };
}
