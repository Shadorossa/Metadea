import { describe, it, expect } from 'vitest';
import { canRedoEntry, canUndoEntry, createEmptyVersionEntry, entryInit, entryReducer, type EntryState } from './library-log-state';
import { UNDO_HISTORY_LIMIT } from '../../shared/state/undo-history';

const ID = 'game:1';

function loaded(): EntryState {
  const state: EntryState = { ...entryInit, activeLogId: ID };
  return entryReducer(state, { type: 'LOAD_LOG', id: ID, entry: createEmptyVersionEntry(ID) });
}

describe('entryReducer undo/redo', () => {
  it('a load has nothing to undo and UNDO/REDO are no-ops', () => {
    const state = loaded();
    expect(canUndoEntry(state)).toBe(false);
    expect(canRedoEntry(state)).toBe(false);
    expect(entryReducer(state, { type: 'UNDO' })).toBe(state);
    expect(entryReducer(state, { type: 'REDO' })).toBe(state);
  });

  it('undo restores the logs before the last edit and redo re-applies it', () => {
    const base = loaded();
    const rated = entryReducer(base, { type: 'UPDATE_LOG', updates: { rating: 8 } });
    const completed = entryReducer(rated, { type: 'UPDATE_LOG', updates: { status: 'completed', progress: 10 } });
    expect(completed.logs[ID].status).toBe('completed');

    const undone = entryReducer(completed, { type: 'UNDO' });
    expect(undone.logs).toEqual(rated.logs);
    expect(undone.logs[ID].rating).toBe(8);
    expect(canRedoEntry(undone)).toBe(true);

    const undoneTwice = entryReducer(undone, { type: 'UNDO' });
    expect(undoneTwice.logs).toEqual(base.logs);
    expect(canUndoEntry(undoneTwice)).toBe(false);

    expect(entryReducer(undoneTwice, { type: 'REDO' }).logs).toEqual(rated.logs);
  });

  it('month grid edits are undoable too, and bulk/version edits record a step each', () => {
    let state = loaded();
    state = entryReducer(state, { type: 'SET_MONTH', ids: [ID], primaryId: ID, key: '2024-03', year: 2024 });
    expect(state.monthlyHistory).toEqual({ '2024-03': [ID] });
    state = entryReducer(state, { type: 'UPDATE_LOGS_BULK', updatesById: { [ID]: { progress: 3 } } });
    state = entryReducer(state, { type: 'SET_VERSION', value: 'game:2', baseId: ID });
    expect(state.history.past).toHaveLength(3);

    state = entryReducer(state, { type: 'UNDO' });
    expect(state.logs[ID].selectedVersion).toBe('');
    state = entryReducer(state, { type: 'UNDO' });
    expect(state.logs[ID].progress).toBe(0);
    state = entryReducer(state, { type: 'UNDO' });
    expect(state.monthlyHistory).toEqual({});
  });

  it('tab switches and the year picker are not history entries', () => {
    let state = loaded();
    state = entryReducer(state, { type: 'SWITCH_LOG', id: 'game:2' });
    state = entryReducer(state, { type: 'SET_YEAR', delta: 1 });
    state = entryReducer(state, { type: 'SET_SELECTED_YEAR', year: 2020 });
    expect(canUndoEntry(state)).toBe(false);
  });

  it('coalesces a notes typing burst into one step', () => {
    let state = loaded();
    state = entryReducer(state, { type: 'UPDATE_LOG', updates: { notes: 'H' }, coalesceKey: 'notes', at: 100 });
    state = entryReducer(state, { type: 'UPDATE_LOG', updates: { notes: 'Hi' }, coalesceKey: 'notes', at: 200 });
    state = entryReducer(state, { type: 'UPDATE_LOG', updates: { notes: 'Hi!' }, coalesceKey: 'notes', at: 300 });
    expect(state.history.past).toHaveLength(1);
    expect(entryReducer(state, { type: 'UNDO' }).logs[ID].notes).toBe('');
  });

  it('is bounded and a later load starts a fresh history', () => {
    let state = loaded();
    for (let i = 0; i < UNDO_HISTORY_LIMIT + 3; i++) state = entryReducer(state, { type: 'UPDATE_LOG', updates: { progress: i } });
    expect(state.history.past).toHaveLength(UNDO_HISTORY_LIMIT);
    const reloaded = entryReducer(state, { type: 'LOAD_LOG', id: 'game:2', entry: createEmptyVersionEntry('game:2') });
    expect(canUndoEntry(reloaded)).toBe(false);
    expect(canUndoEntry(entryReducer(state, { type: 'LOAD_HISTORY', history: {}, foundKey: null }))).toBe(false);
  });
});
