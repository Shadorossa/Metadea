import { describe, expect, it } from 'vitest';
import {
  initialTierEditorState, tierCanRedo, tierCanUndo, tierEditorReducer, tierIsDirty, TIER_NAME_MAX_LENGTH,
  type TierDraft,
} from './tier-editor-state';
import { emptyBoard, moveItems, addToPool } from './tier-board';
import { DEFAULT_TIER_ROWS } from './tier-palette';
import { isHexColor, labelTextColor, newRowId, nextRowColor } from './tier-palette';
import { parseTierSettings, serializeTierSettings, DEFAULT_TIER_SETTINGS } from './tier-settings';

function draft(): TierDraft {
  return { name: 'Anime 2024', description: '', isPublic: false, board: addToPool(emptyBoard(DEFAULT_TIER_ROWS), ['a', 'b']).board };
}

describe('tierEditorReducer', () => {
  it('records board edits and undoes/redoes them', () => {
    let state = initialTierEditorState(draft());
    state = tierEditorReducer(state, { type: 'board', update: b => moveItems(b, ['a'], 's') });
    expect(state.draft.board.rows[0].items).toEqual(['a']);
    expect(tierCanUndo(state)).toBe(true);
    expect(tierIsDirty(state)).toBe(true);

    state = tierEditorReducer(state, { type: 'undo' });
    expect(state.draft.board.rows[0].items).toEqual([]);
    expect(tierCanRedo(state)).toBe(true);

    state = tierEditorReducer(state, { type: 'redo' });
    expect(state.draft.board.rows[0].items).toEqual(['a']);
    expect(state.revision).toBe(3);
  });

  it('coalesces a colour drag into one step', () => {
    let state = initialTierEditorState(draft());
    for (const [i, color] of ['#000001', '#000002', '#000003'].entries()) {
      state = tierEditorReducer(state, { type: 'board', update: b => ({ ...b, rows: b.rows.map((r, j) => (j === 0 ? { ...r, color } : r)) }), coalesceKey: 'color:s', at: i * 100 });
    }
    expect(state.history.past).toHaveLength(1);
    expect(tierEditorReducer(state, { type: 'undo' }).draft.board.rows[0].color).toBe('#ff7f7f');
  });

  it('ignores no-op board updates', () => {
    const state = initialTierEditorState(draft());
    expect(tierEditorReducer(state, { type: 'board', update: b => b })).toBe(state);
    expect(tierEditorReducer(state, { type: 'undo' })).toBe(state);
    expect(tierEditorReducer(state, { type: 'redo' })).toBe(state);
  });

  it('coalesces typing into one undo step and clamps length', () => {
    let state = initialTierEditorState(draft());
    state = tierEditorReducer(state, { type: 'text', field: 'name', value: 'A', at: 1000 });
    state = tierEditorReducer(state, { type: 'text', field: 'name', value: 'AB', at: 1200 });
    expect(state.history.past).toHaveLength(1);
    state = tierEditorReducer(state, { type: 'undo' });
    expect(state.draft.name).toBe('Anime 2024');
    state = tierEditorReducer(state, { type: 'text', field: 'description', value: 'x'.repeat(1000), at: 0 });
    expect(state.draft.description.length).toBeLessThan(1000);
    state = tierEditorReducer(state, { type: 'text', field: 'name', value: 'y'.repeat(200), at: 5000 });
    expect(state.draft.name).toHaveLength(TIER_NAME_MAX_LENGTH);
  });

  it('tracks the public flag and saved revisions', () => {
    let state = initialTierEditorState(draft());
    state = tierEditorReducer(state, { type: 'public', value: true });
    expect(state.draft.isPublic).toBe(true);
    expect(tierEditorReducer(state, { type: 'public', value: true })).toBe(state);
    state = tierEditorReducer(state, { type: 'saved', revision: state.revision });
    expect(tierIsDirty(state)).toBe(false);
    expect(tierEditorReducer(state, { type: 'saved', revision: 0 })).toBe(state);
    const loaded = tierEditorReducer(state, { type: 'load', draft: draft() });
    expect(loaded.revision).toBe(0);
    expect(tierCanUndo(loaded)).toBe(false);
  });
});

describe('palette and settings', () => {
  it('continues the palette and wraps', () => {
    expect(nextRowColor('#ff7f7f')).toBe('#ffbf7f');
    expect(nextRowColor('#F7F7F7')).toBe('#ff7f7f');
    expect(nextRowColor(undefined)).toBe('#ff7f7f');
    expect(nextRowColor('#abcdef')).toBe('#ff7f7f');
  });

  it('picks readable label text', () => {
    expect(labelTextColor('#ffff7f')).toBe('#111111');
    expect(labelTextColor('#3b3b3b')).toBe('#f7f7f7');
    expect(labelTextColor('red')).toBe('#111111');
    expect(isHexColor('#12abEF')).toBe(true);
    expect(isHexColor('#123')).toBe(false);
  });

  it('generates unique row ids even with a stuck random source', () => {
    expect(newRowId(['r0'], () => 0)).not.toBe('r0');
    expect(newRowId([], () => 0.5)).toMatch(/^r[0-9a-z]+$/);
  });

  it('parses settings field by field', () => {
    expect(parseTierSettings(null)).toEqual(DEFAULT_TIER_SETTINGS);
    expect(parseTierSettings({ thumb_size: 'large', show_titles: 'yes' })).toEqual({ thumbSize: 'large', showTitles: false });
    expect(parseTierSettings(serializeTierSettings({ thumbSize: 'small', showTitles: true }))).toEqual({ thumbSize: 'small', showTitles: true });
  });
});
