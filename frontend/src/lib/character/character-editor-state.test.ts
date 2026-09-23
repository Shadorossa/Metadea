import { describe, expect, it } from 'vitest';
import {
  characterEditorInit,
  characterEditorReducer,
  createEmptyCharacterDraft,
  hasChanges,
  type CharacterDraft,
  type CharacterEditorState,
} from './character-editor-state';
import type { CharacterEntry } from '../tauri/characters';

const entry: CharacterEntry = { id: '1', external_id: 'character:a:1', name: 'Rin', created_at: '', updated_at: '' };

function loadedDraft(overrides: Partial<CharacterDraft> = {}): CharacterDraft {
  return {
    ...createEmptyCharacterDraft(),
    character: entry,
    name: 'Rin',
    aliases: ['Rin T.'],
    appearances: [{ media_external_id: 'anime:1', relation_type: 'MAIN', title: 'Show', cover: null }],
    mergedCharacters: [{ external_id: 'character:a:2', name: 'Rin (alt)' }],
    ...overrides,
  };
}

function loadedState(): CharacterEditorState {
  const baseline = loadedDraft();
  return { baseline, draft: baseline };
}

describe('characterEditorReducer', () => {
  it('starts empty with no character and no changes', () => {
    expect(characterEditorInit.draft.character).toBeNull();
    expect(characterEditorInit.baseline.character).toBeNull();
    expect(hasChanges(characterEditorInit)).toBe(false);
  });

  it('load replaces both sides with the given state', () => {
    const loaded = loadedState();
    const next = characterEditorReducer(characterEditorInit, { type: 'load', state: loaded });
    expect(next.baseline).toBe(loaded.baseline);
    expect(next.draft).toBe(loaded.draft);
    expect(hasChanges(next)).toBe(false);
  });

  it('load keeps a draft that differs from its baseline (pending appearance seed)', () => {
    const baseline = loadedDraft();
    const draft = loadedDraft({ appearances: [...baseline.appearances, { media_external_id: 'anime:2', relation_type: 'SUPPORTING', title: 'Seed', cover: null }] });
    const next = characterEditorReducer(characterEditorInit, { type: 'load', state: { baseline, draft } });
    expect(next.draft.appearances).toHaveLength(2);
    expect(next.baseline.appearances).toHaveLength(1);
    expect(hasChanges(next)).toBe(true);
  });

  it('edit with an object patch only touches the draft', () => {
    const loaded = loadedState();
    const next = characterEditorReducer(loaded, { type: 'edit', patch: { name: 'Rin Tohsaka' } });
    expect(next.draft.name).toBe('Rin Tohsaka');
    expect(next.draft.aliases).toBe(loaded.draft.aliases);
    expect(next.baseline).toBe(loaded.baseline);
    expect(hasChanges(next)).toBe(true);
  });

  it('edit with a function patch reads the latest draft', () => {
    const loaded = loadedState();
    const first = characterEditorReducer(loaded, { type: 'edit', patch: prev => ({ aliases: [...prev.aliases, 'Tohsaka'] }) });
    const second = characterEditorReducer(first, { type: 'edit', patch: prev => ({ aliases: [...prev.aliases, 'Archer'] }) });
    expect(second.draft.aliases).toEqual(['Rin T.', 'Tohsaka', 'Archer']);
  });

  it('editing back to the baseline value reports no changes', () => {
    const loaded = loadedState();
    const edited = characterEditorReducer(loaded, { type: 'edit', patch: { name: 'Other' } });
    const reverted = characterEditorReducer(edited, { type: 'edit', patch: { name: 'Rin' } });
    expect(hasChanges(reverted)).toBe(false);
  });

  it('hasChanges counts a merge-list change even when every field matches', () => {
    const loaded = loadedState();
    const next = characterEditorReducer(loaded, { type: 'edit', patch: prev => ({ mergedCharacters: [...prev.mergedCharacters, { external_id: 'character:a:3', name: 'Third' }] }) });
    expect(hasChanges(next)).toBe(true);
    const reordered = characterEditorReducer(loaded, { type: 'edit', patch: { mergedCharacters: [...loaded.draft.mergedCharacters].reverse() } });
    expect(hasChanges(reordered)).toBe(false);
  });

  it('reset returns to the empty initial state', () => {
    const loaded = loadedState();
    const edited = characterEditorReducer(loaded, { type: 'edit', patch: { name: 'Other' } });
    const next = characterEditorReducer(edited, { type: 'reset' });
    expect(next).toBe(characterEditorInit);
    expect(next.draft.character).toBeNull();
  });
});
