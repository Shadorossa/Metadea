// PrEditorModal's editable state as one reducer (same pattern as
// MediaEditorModal's entryReducer in lib/media/log-state.ts): `baseline` is
// what was loaded, `draft` is what the curator has edited. Every dirty check,
// diff and "removed ids" list the submit path needs is derived from the pair
// here — previously each of these lived as its own `x` / `originalX` useState
// twin in the modal and every check walked them by hand.
import type { MediaCatalogEntry, DbMediaAuthor } from '../../../lib/tauri/catalog';
import type { DbMediaCharacter } from '../../../lib/tauri/characters';
import type { MediaPageData } from '../../../lib/media/types';
import type { SagaRelationType } from '../../../lib/media/saga/saga-relation-types';
import { DIFF_FIELDS } from '../../../lib/media/constants';
import { normField } from '../../shared/PrEditorField';
import { applyResyncToDraft } from './pr-editor-resync';
import type { BundledRelation, EditableRelation } from '../../../lib/media/editor/pr-editor-types';
import {
  canRedo as historyCanRedo, canUndo as historyCanUndo, createUndoHistory, recordUndoSnapshot, redoSnapshot, undoSnapshot,
  type UndoHistory,
} from '../../../lib/shared/state/undo-history';

export interface PrEditorDraft {
  entry: MediaCatalogEntry | null;
  // Bundled In (PART_OF) — this entry is contained by these.
  bundledRelations: BundledRelation[];
  // Reverse of Bundled In — items that have *this* entry as their Bundled In
  // (i.e. this entry is the container). Read/write mirrors bundledRelations
  // exactly, just the other direction (EPISODE instead of PART_OF).
  containedRelations: BundledRelation[];
  // Bundled In's own referenced bundle (bundledRelations[0], if any) gets its
  // *own* Contains list editable right here too — so adding "The Orange Box"
  // as a Bundled In from Half-Life 2's editor lets you also add the rest of
  // the bundle's contents in the same sitting, instead of having to leave
  // and separately open the bundle's own editor to fill in Contains one by
  // one. This entry itself isn't part of this list (it's already implied by
  // the Bundled In relation above); this only covers "the rest".
  bundleChildren: BundledRelation[];
  editableRelations: EditableRelation[];
  recommendations: BundledRelation[];
  // ComicVine issues — split out of editableRelations into their own
  // collapsible section since their titles are often just a bare issue
  // number, which used to clutter the general Relations grid.
  issueRelations: BundledRelation[];
  // Saga — one single ordered chain (chronological order), including this
  // entry itself. Every adjacent pair in this order gets a SEQUEL edge
  // (earlier → later) and a PREQUEL edge (later → earlier) on submit — for
  // every id in the chain, not just the one currently open in the editor.
  sagaOrder: string[];
  // 'main' ids can share a sagaGroups key to collapse into one timeline step
  // and become alternate versions of each other
  // (e.g. a console remaster + its PC original); 'source'/'episode'/'update'
  // ids attach to the nearest preceding group instead (see classifySagaChain).
  sagaRelationTypes: Record<string, SagaRelationType>;
  sagaGroups: Record<string, string>;
  sagaName: string;
  characters: DbMediaCharacter[];
  mediaAuthors: DbMediaAuthor[];
}

export interface PrEditorState {
  baseline: PrEditorDraft;
  draft: PrEditorDraft;
  // Undo/redo over `draft` (mod+z / mod+y in the modal). Every
  // draft-changing action records the previous draft; load/reset/resync
  // start a fresh history since their result is a new "origin".
  history: UndoHistory<PrEditorDraft>;
}

export type PrEditorDraftPatch = Partial<PrEditorDraft> | ((draft: PrEditorDraft) => Partial<PrEditorDraft>);

export type PrEditorAction =
  // Sets the same values on both sides — what a fresh load (or a later
  // lazy load of one list, e.g. the referenced bundle's children) does.
  | { type: 'load'; patch: Partial<PrEditorDraft> }
  // Curator edit: draft only. A function patch reads the latest draft, the
  // reducer equivalent of a functional setState updater. `coalesceKey` +
  // `at` (ms) mark a text-field keystroke so a burst on one field is a
  // single undo step (see lib/shared/state/undo-history.ts).
  | { type: 'edit'; patch: PrEditorDraftPatch; coalesceKey?: string; at?: number }
  | { type: 'reset' }
  | { type: 'resync'; liveData: MediaPageData; externalId: string }
  | { type: 'undo' }
  | { type: 'redo' };

// Values that don't live in the draft but every derived check needs.
export interface PrEditorContext {
  externalId: string;
  // tm.relations.RECOMMENDATION — a recommendation becomes an EditableRelation
  // of type RECOMMENDATION on submit, and its type_label is this text.
  recommendationLabel: string;
}

export function enforceSingleMovieEpisode(entry: MediaCatalogEntry): MediaCatalogEntry {
  return entry.type === 'movie' && entry.total_count !== 1 ? { ...entry, total_count: 1 } : entry;
}

export function createEmptyDraft(externalId: string): PrEditorDraft {
  return {
    entry: null,
    bundledRelations: [],
    containedRelations: [],
    bundleChildren: [],
    editableRelations: [],
    recommendations: [],
    issueRelations: [],
    sagaOrder: [externalId],
    sagaRelationTypes: {},
    sagaGroups: {},
    sagaName: '',
    characters: [],
    mediaAuthors: [],
  };
}

export function createInitialPrEditorState(externalId: string): PrEditorState {
  return { baseline: createEmptyDraft(externalId), draft: createEmptyDraft(externalId), history: createUndoHistory() };
}

export function canUndo(state: PrEditorState): boolean { return historyCanUndo(state.history); }
export function canRedo(state: PrEditorState): boolean { return historyCanRedo(state.history); }

// The draft's entry always carries the movie rule; the baseline keeps the
// row exactly as loaded (so a movie whose stored total_count isn't 1 shows
// up as a pending change, same as before).
function toDraftPatch<T extends Partial<PrEditorDraft>>(patch: T): T {
  return patch.entry ? { ...patch, entry: enforceSingleMovieEpisode(patch.entry) } : patch;
}

export function prEditorReducer(state: PrEditorState, action: PrEditorAction): PrEditorState {
  switch (action.type) {
    case 'load':
      return {
        baseline: { ...state.baseline, ...action.patch },
        draft: { ...state.draft, ...toDraftPatch(action.patch) },
        history: createUndoHistory(),
      };
    case 'edit': {
      const patch = typeof action.patch === 'function' ? action.patch(state.draft) : action.patch;
      // Same bail-out a functional setState updater returning `prev` gets:
      // no new state object when nothing actually changed.
      const keys = Object.keys(patch) as (keyof PrEditorDraft)[];
      if (keys.every(key => patch[key] === state.draft[key])) return state;
      return {
        ...state,
        draft: { ...state.draft, ...patch },
        history: recordUndoSnapshot(state.history, state.draft, { coalesceKey: action.coalesceKey, at: action.at }),
      };
    }
    case 'reset':
      return { ...state, draft: toDraftPatch(state.baseline), history: createUndoHistory() };
    case 'resync':
      return { ...state, draft: applyResyncToDraft(state.draft, action.liveData, action.externalId), history: createUndoHistory() };
    case 'undo': {
      const step = undoSnapshot(state.history, state.draft);
      return step ? { ...state, draft: step.snapshot, history: step.history } : state;
    }
    case 'redo': {
      const step = redoSnapshot(state.history, state.draft);
      return step ? { ...state, draft: step.snapshot, history: step.history } : state;
    }
    default:
      return state;
  }
}

// ── Baseline id sets (the old `original*Ids` / `original*Types` state) ────────
// Built exactly the way pr-editor-load.ts used to build them, so every
// consumer sees identical values.

const idSet = (list: BundledRelation[]) => new Set(list.map(r => r.external_id));

export function originalBundledIds(state: PrEditorState): Set<string> { return idSet(state.baseline.bundledRelations); }
export function originalContainedIds(state: PrEditorState): Set<string> { return idSet(state.baseline.containedRelations); }
export function originalBundleChildIds(state: PrEditorState): Set<string> { return idSet(state.baseline.bundleChildren); }
export function originalRecommendationIds(state: PrEditorState): Set<string> { return idSet(state.baseline.recommendations); }
export function originalIssueIds(state: PrEditorState): Set<string> { return idSet(state.baseline.issueRelations); }
// Maps id -> its original relation_type, both to know which ids existed
// before (Set-like via .has) and to detect an in-place type change on an
// id that's still present (a plain id Set couldn't tell the two apart).
export function originalEditableRelationTypes(state: PrEditorState): Map<string, string> {
  return new Map(state.baseline.editableRelations.map(r => [r.related_media_external_id, r.relation_type]));
}

// ── Derived diffs ─────────────────────────────────────────────────────────────

export function toRecommendationRelation(recommendation: BundledRelation, recommendationLabel: string): EditableRelation {
  return {
    related_media_external_id: recommendation.external_id,
    relation_type: 'RECOMMENDATION',
    type_label: recommendationLabel,
    title: recommendation.title,
    cover: recommendation.cover,
  };
}

// True when two string records differ after normalizing each value (missing
// keys fall back through `normalize`), regardless of which record a key is in.
function recordsDiffer(a: Record<string, string>, b: Record<string, string>, normalize: (v?: string) => string): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (normalize(a[k]) !== normalize(b[k])) return true;
  }
  return false;
}

export function isFieldChanged(state: PrEditorState, field: keyof MediaCatalogEntry): boolean {
  const { entry } = state.draft;
  const originalEntry = state.baseline.entry;
  return !!originalEntry && normField(entry?.[field]) !== normField(originalEntry[field]);
}

export function editedFields(state: PrEditorState): (keyof MediaCatalogEntry)[] {
  return DIFF_FIELDS.filter(([field]) => isFieldChanged(state, field)).map(([field]) => field);
}

export function charactersChanged(state: PrEditorState): boolean {
  const key = (c: DbMediaCharacter) => `${c.external_id}::${c.relation_type ?? ''}`;
  const a = new Set(state.draft.characters.map(key));
  const b = new Set(state.baseline.characters.map(key));
  return a.size !== b.size || [...a].some(k => !b.has(k));
}

export interface PrEditorDiff {
  addedBundled: BundledRelation[];
  removedBundledIds: string[];
  addedContained: BundledRelation[];
  removedContainedIds: string[];
  addedBundleChildren: BundledRelation[];
  removedBundleChildIds: string[];
  addedEditableRelations: EditableRelation[];
  removedEditableRelationIds: string[];
  changedEditableRelations: EditableRelation[];
  addedIssues: BundledRelation[];
  removedIssueIds: string[];
  addedSaga: string[];
  removedSaga: string[];
  sagaOrderChanged: boolean;
  relTypesChanged: boolean;
  groupsChanged: boolean;
  sagaNameChanged: boolean;
  // Only used for the GitHub upload merge (submitCollaborativeProposal's
  // mergeListByKey) — tells "removed this session" apart from "never
  // loaded it" so an upstream row someone else added isn't clobbered.
  removedCharacterIds: string[];
  removedAuthorIds: string[];
}

export function getPrEditorDiff(state: PrEditorState, ctx: PrEditorContext): PrEditorDiff {
  const { draft, baseline } = state;
  const { externalId, recommendationLabel } = ctx;
  const bundledIds = originalBundledIds(state);
  const containedIds = originalContainedIds(state);
  const bundleChildIds = originalBundleChildIds(state);
  const editableTypes = originalEditableRelationTypes(state);
  const recommendationIds = originalRecommendationIds(state);
  const issueIds = originalIssueIds(state);
  const originalSagaIds = new Set(baseline.sagaOrder);
  return {
    addedBundled: draft.bundledRelations.filter(r => !bundledIds.has(r.external_id)),
    removedBundledIds: [...bundledIds].filter(id => !draft.bundledRelations.some(r => r.external_id === id)),
    addedContained: draft.containedRelations.filter(r => !containedIds.has(r.external_id)),
    removedContainedIds: [...containedIds].filter(id => !draft.containedRelations.some(r => r.external_id === id)),
    addedBundleChildren: draft.bundleChildren.filter(r => !bundleChildIds.has(r.external_id)),
    removedBundleChildIds: [...bundleChildIds].filter(id => !draft.bundleChildren.some(r => r.external_id === id)),
    addedEditableRelations: [
      ...draft.editableRelations.filter(r => !editableTypes.has(r.related_media_external_id)),
      ...draft.recommendations.filter(r => !recommendationIds.has(r.external_id)).map(r => toRecommendationRelation(r, recommendationLabel)),
    ],
    removedEditableRelationIds: [
      ...[...editableTypes.keys()].filter(id => !draft.editableRelations.some(r => r.related_media_external_id === id)),
      ...[...recommendationIds].filter(id => !draft.recommendations.some(r => r.external_id === id)),
    ],
    changedEditableRelations: draft.editableRelations.filter(r => {
      const originalType = editableTypes.get(r.related_media_external_id);
      return originalType !== undefined && originalType !== r.relation_type;
    }),
    addedIssues: draft.issueRelations.filter(r => !issueIds.has(r.external_id)),
    removedIssueIds: [...issueIds].filter(id => !draft.issueRelations.some(r => r.external_id === id)),
    addedSaga: draft.sagaOrder.filter(id => id !== externalId && !originalSagaIds.has(id)),
    removedSaga: baseline.sagaOrder.filter(id => id !== externalId && !draft.sagaOrder.includes(id)),
    sagaOrderChanged: draft.sagaOrder.join(',') !== baseline.sagaOrder.join(','),
    relTypesChanged: recordsDiffer(draft.sagaRelationTypes, baseline.sagaRelationTypes, v => v || 'main'),
    groupsChanged: recordsDiffer(draft.sagaGroups, baseline.sagaGroups, v => (v || '').trim()),
    sagaNameChanged: draft.sagaName !== baseline.sagaName,
    removedCharacterIds: baseline.characters
      .filter(c => !draft.characters.some(cur => cur.external_id === c.external_id))
      .map(c => c.external_id),
    removedAuthorIds: baseline.mediaAuthors
      .filter(a => !draft.mediaAuthors.some(cur => cur.external_id === a.external_id))
      .map(a => a.external_id),
  };
}

export function hasChanges(state: PrEditorState, ctx: PrEditorContext): boolean {
  const { entry } = state.draft;
  const originalEntry = state.baseline.entry;
  if (!entry || !originalEntry) return false;
  // Not in DIFF_FIELDS — it's a curator flag toggled by its own dedicated
  // "Eliminar de Metadea" button, not a regular diffable field with a
  // label, but flipping it is still a real change that must enable Submit.
  if (entry.blocked_at !== originalEntry.blocked_at) return true;
  if (DIFF_FIELDS.some(([field]) => isFieldChanged(state, field))) return true;
  if (charactersChanged(state)) return true;
  const d = getPrEditorDiff(state, ctx);
  return d.addedBundled.length > 0 || d.removedBundledIds.length > 0
    || d.addedContained.length > 0 || d.removedContainedIds.length > 0
    || d.addedBundleChildren.length > 0 || d.removedBundleChildIds.length > 0
    || d.addedEditableRelations.length > 0 || d.removedEditableRelationIds.length > 0 || d.changedEditableRelations.length > 0
    || d.addedIssues.length > 0 || d.removedIssueIds.length > 0
    || d.addedSaga.length > 0 || d.removedSaga.length > 0
    || d.sagaOrderChanged || d.relTypesChanged || d.groupsChanged || d.sagaNameChanged;
}

// Every other entry this session's edits touch (for the proposal session's
// "affected" tab markers).
export function affectedExternalIds(state: PrEditorState, ctx: PrEditorContext): string[] {
  const diff = getPrEditorDiff(state, ctx);
  return [...new Set([
    ...diff.addedBundled.map(item => item.external_id), ...diff.removedBundledIds,
    ...diff.addedContained.map(item => item.external_id), ...diff.removedContainedIds,
    ...diff.addedBundleChildren.map(item => item.external_id), ...diff.removedBundleChildIds,
    ...diff.addedEditableRelations.map(item => item.related_media_external_id), ...diff.removedEditableRelationIds,
    ...diff.changedEditableRelations.map(item => item.related_media_external_id),
    ...diff.addedIssues.map(item => item.external_id), ...diff.removedIssueIds,
    ...diff.addedSaga, ...diff.removedSaga,
    ...(diff.sagaOrderChanged ? state.draft.sagaOrder.filter(id => id !== ctx.externalId) : []),
  ])];
}
