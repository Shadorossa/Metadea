// The tier editor's reducer: the undoable draft (title, description, board)
// plus its history (lib/shared/state/undo-history.ts). Board edits are one
// undo step each; typing in the title/description coalesces per field.
// `revision` bumps on every draft change so the autosave effect has one
// value to watch; `savedRevision` is what the last successful save wrote.
import {
  createUndoHistory, recordUndoSnapshot, redoSnapshot, undoSnapshot, canRedo, canUndo,
  type UndoHistory,
} from '../shared/state/undo-history';
import type { TierBoard } from './tier-board';

export interface TierDraft {
  name: string;
  description: string;
  isPublic: boolean;
  board: TierBoard;
}

export interface TierEditorState {
  draft: TierDraft;
  history: UndoHistory<TierDraft>;
  revision: number;
  savedRevision: number;
}

export type TierEditorAction =
  | { type: 'load'; draft: TierDraft }
  /** `coalesceKey` merges fast repeats (a colour picker drag) into one step. */
  | { type: 'board'; update: (board: TierBoard) => TierBoard; coalesceKey?: string; at?: number }
  | { type: 'text'; field: 'name' | 'description'; value: string; at: number }
  | { type: 'public'; value: boolean }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'saved'; revision: number };

export const TIER_NAME_MAX_LENGTH = 80;
export const TIER_DESCRIPTION_MAX_LENGTH = 500;

export function initialTierEditorState(draft: TierDraft): TierEditorState {
  return { draft, history: createUndoHistory(), revision: 0, savedRevision: 0 };
}

function commit(state: TierEditorState, draft: TierDraft, history: UndoHistory<TierDraft>): TierEditorState {
  return { ...state, draft, history, revision: state.revision + 1 };
}

export function tierEditorReducer(state: TierEditorState, action: TierEditorAction): TierEditorState {
  switch (action.type) {
    case 'load':
      return initialTierEditorState(action.draft);
    case 'board': {
      const board = action.update(state.draft.board);
      if (board === state.draft.board) return state;
      const history = recordUndoSnapshot(state.history, state.draft, { coalesceKey: action.coalesceKey, at: action.at });
      return commit(state, { ...state.draft, board }, history);
    }
    case 'text': {
      const max = action.field === 'name' ? TIER_NAME_MAX_LENGTH : TIER_DESCRIPTION_MAX_LENGTH;
      const value = action.value.slice(0, max);
      if (value === state.draft[action.field]) return state;
      const history = recordUndoSnapshot(state.history, state.draft, { coalesceKey: action.field, at: action.at });
      return commit(state, { ...state.draft, [action.field]: value }, history);
    }
    case 'public':
      if (action.value === state.draft.isPublic) return state;
      return commit(state, { ...state.draft, isPublic: action.value }, recordUndoSnapshot(state.history, state.draft));
    case 'undo': {
      const step = undoSnapshot(state.history, state.draft);
      return step ? commit(state, step.snapshot, step.history) : state;
    }
    case 'redo': {
      const step = redoSnapshot(state.history, state.draft);
      return step ? commit(state, step.snapshot, step.history) : state;
    }
    case 'saved':
      return action.revision > state.savedRevision ? { ...state, savedRevision: action.revision } : state;
  }
}

export function tierCanUndo(state: TierEditorState): boolean { return canUndo(state.history); }
export function tierCanRedo(state: TierEditorState): boolean { return canRedo(state.history); }
export function tierIsDirty(state: TierEditorState): boolean { return state.revision !== state.savedRevision; }
