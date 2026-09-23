// State shape and reducer for CharacterPrEditorModal's edited character —
// the same baseline/draft split MediaEditorModal keeps in log-state.ts,
// extracted so the modal's own file is just UI/orchestration. `baseline` is
// what the editor loaded (the "original" side of every diff), `draft` is what
// the user has edited so far; both share one shape so a diff helper is a
// plain (baseline, draft) comparison instead of eleven paired states.
import type { CharacterEntry, CharacterMerge } from '../tauri/characters';
import type { ParsedCharacteristic } from './biography-parser';
import { hasChanged, mergedCharactersChanged, type AppearanceRow, type VoiceActorRow } from './character-editor-diff';

export interface CharacterDraft {
  character: CharacterEntry | null;
  name: string;
  nameNative: string;
  aliases: string[];
  imageUrl: string;
  characteristics: ParsedCharacteristic[];
  cleanBiography: string;
  appearances: AppearanceRow[];
  mergedCharacters: CharacterMerge[];
  voiceActors: VoiceActorRow[];
}

export interface CharacterEditorState {
  baseline: CharacterDraft;
  draft: CharacterDraft;
}

export type CharacterDraftPatch =
  | Partial<CharacterDraft>
  | ((draft: CharacterDraft) => Partial<CharacterDraft>);

export type CharacterEditorAction =
  | { type: 'load'; state: CharacterEditorState }
  // A function patch reads the latest draft (the `setX(previous => ...)`
  // form the modal used before), so two consecutive edits never clobber
  // each other.
  | { type: 'edit'; patch: CharacterDraftPatch }
  | { type: 'reset' };

export function createEmptyCharacterDraft(): CharacterDraft {
  return {
    character: null,
    name: '',
    nameNative: '',
    aliases: [],
    imageUrl: '',
    characteristics: [],
    cleanBiography: '',
    appearances: [],
    mergedCharacters: [],
    voiceActors: [],
  };
}

export const characterEditorInit: CharacterEditorState = {
  baseline: createEmptyCharacterDraft(),
  draft: createEmptyCharacterDraft(),
};

export function characterEditorReducer(state: CharacterEditorState, action: CharacterEditorAction): CharacterEditorState {
  switch (action.type) {
    case 'load':
      return { baseline: action.state.baseline, draft: action.state.draft };
    case 'edit': {
      const patch = typeof action.patch === 'function' ? action.patch(state.draft) : action.patch;
      return { ...state, draft: { ...state.draft, ...patch } };
    }
    case 'reset':
      return characterEditorInit;
    default:
      return state;
  }
}

// Field-level diff OR a merge-list change — the "is there anything to
// submit / warn about losing" check.
export const hasChanges = (state: CharacterEditorState): boolean =>
  hasChanged(state.baseline, state.draft) || mergedCharactersChanged(state.baseline, state.draft);
