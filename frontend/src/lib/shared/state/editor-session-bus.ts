// Typed contract between the media PR editor session (usePrEditorSession) and
// the globally mounted character editor (CharacterPrEditorModal). The two
// never import each other's components; they co-operate through the window
// objects and CustomEvents declared here, so every dispatch/listen/call site
// shares one shape instead of `(window as any)`.
import type { PrEditorSessionTab } from '../../media/editor/pr-editor-types';
import type { PreparedCharacterProposal } from '../../character/character-editor-submit';

// The media entry a character was created FROM, seeded into its appearance
// list on first load (see CharacterPrEditorModal's pendingAppearanceRef).
export interface CharacterAppearanceSeed {
  media_external_id: string;
  title: string;
  cover: string | null;
  release_year?: number | null;
  release_month?: number | null;
  release_day?: number | null;
}

export interface CharacterEditorOpenOptions {
  mediaSession?: boolean;
  title?: string;
}

export type PrEditorActiveTab =
  | { kind: 'character'; externalId: string }
  | { kind: 'media'; externalId: string | null };

// Controls the session header publishes for the character editor to drive
// (mounted by usePrEditorSession as window.__metadeaPrEditorSession).
export interface PrEditorSessionController {
  tabs: PrEditorSessionTab[];
  active: PrEditorActiveTab;
  navigate: (tab: PrEditorSessionTab) => void;
  closeTab: (tab: PrEditorSessionTab) => void;
  requestClose: () => void;
  finishSession: () => void;
  submitProposal: () => void;
  hasChanges: boolean;
}

// Mounted by CharacterPrEditorModal as window.__metadeaCharacterEditor.
export interface CharacterEditorApi {
  open: (externalId: string, initialAppearance?: CharacterAppearanceSeed, options?: CharacterEditorOpenOptions) => void;
  closeSession: () => void;
  closeTab: (externalId: string, discard?: boolean) => void;
  prepareProposal: (ownerId: string, setStatus: (message: string) => void) => Promise<PreparedCharacterProposal | null>;
}

export interface EditorSessionEventMap {
  'metadea:pr-editor-active-tab-change': { kind: 'media' | 'character' | undefined; externalId: string | null };
  'metadea:character-editor-session-change':
    | { action: 'update'; externalId: string; title?: string; dirty?: boolean }
    | { action: 'close'; externalId: string };
  'metadea:pr-editor-session-update': PrEditorSessionController;
}

export type EditorSessionEventType = keyof EditorSessionEventMap;

export function emit<T extends EditorSessionEventType>(type: T, detail: EditorSessionEventMap[T]): void {
  window.dispatchEvent(new CustomEvent(type, { detail }));
}

export function on<T extends EditorSessionEventType>(
  type: T,
  handler: (detail: EditorSessionEventMap[T] | undefined) => void,
): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<EditorSessionEventMap[T]>).detail);
  window.addEventListener(type, listener);
  return () => window.removeEventListener(type, listener);
}
