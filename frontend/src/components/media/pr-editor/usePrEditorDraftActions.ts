// Every list-editing handler PrEditorModal's tabs need (add/remove/reorder
// on each relation list, the saga chain, the cast), built over the modal's
// own `edit` dispatch. State stays in the modal's reducer; this only turns
// UI events into draft patches, plus the drag-reorder hooks each list owns.
import type { SearchResult as ApiSearchResult } from '../../../lib/search';
import type { DbMediaCharacter } from '../../../lib/tauri/characters';
import type { MediaMeta } from '../../../lib/media/saga/saga-grouping';
import type { Translations } from '../../../i18n/index';
import { CANONICAL_RELATION_LABELS } from '../../../lib/media/saga/canonical-relations';
import { useDragReorder } from '../hooks/useDragReorder';
import { moveItem, useListReorder } from '../hooks/useListReorder';
import type { PrEditorDraft, PrEditorDraftPatch } from './pr-editor-state';
import { canGroupSagaItems, findDuplicateSagaTitleId, groupSagaItems, ungroupSagaItems } from './pr-editor-saga-actions';

const DEFAULT_NEW_RELATION_TYPE = 'REL_ADAPTATION';

// The five BundledRelation-shaped lists (bundled-in, contains, bundle
// children, recommendations, issues) all add and remove the same way — only
// the draft key they act on differs.
export type RelationListKey = 'bundledRelations' | 'containedRelations' | 'bundleChildren' | 'recommendations' | 'issueRelations';

const appendRelationPatch = (key: RelationListKey, result: ApiSearchResult): PrEditorDraftPatch => draft =>
  draft[key].some(r => r.external_id === result.externalId) ? {} : { [key]: [...draft[key], {
    external_id: result.externalId,
    title: result.titleMain,
    cover: result.coverUrl,
  }] };

const removeRelationPatch = (key: RelationListKey, id: string): PrEditorDraftPatch => draft =>
  ({ [key]: draft[key].filter(r => r.external_id !== id) });

interface Params {
  pe: Translations['pr_editor'];
  externalId: string;
  draft: PrEditorDraft;
  edit: (patch: PrEditorDraftPatch) => void;
  sagaMeta: Record<string, MediaMeta>;
  setSagaMeta: React.Dispatch<React.SetStateAction<Record<string, MediaMeta>>>;
}

export function usePrEditorDraftActions({ pe, externalId, draft, edit, sagaMeta, setSagaMeta }: Params) {
  const { sagaOrder, bundledRelations, containedRelations, bundleChildren, editableRelations, recommendations, issueRelations, characters } = draft;
  const sagaCtx = { externalId, sagaMeta };
  // Also what the Relations dropdown itself displays (not just what gets
  // persisted) — a curator's own UI language shouldn't decide what a PR
  // reviewer in a different language sees on that same option, and this is
  // the exact text that ends up in type_label (see updateType below), so
  // showing anything else here would just be misleading.
  const canonicalRelationLabels = CANONICAL_RELATION_LABELS;

  // ── Saga ───────────────────────────────────────────────────────────────────

  const reorderSaga = (fromIndex: number, toIndex: number) => {
    const next = moveItem(sagaOrder, fromIndex, toIndex);
    if (next) edit({ sagaOrder: next });
  };
  const sagaDrag = useDragReorder(reorderSaga, {
    onDwellDrop: (fromIndex, toIndex) => {
      const grouped = groupSagaItems(draft, sagaCtx, fromIndex, toIndex);
      if (grouped) edit(grouped);
    },
    canDwellOver: (fromIndex, toIndex) => canGroupSagaItems(draft, sagaCtx, fromIndex, toIndex),
    dwellMs: 1000,
  });
  const saga = {
    draggedIndex: sagaDrag.draggedIndex,
    dragHandlers: sagaDrag.dragHandlers,
    groupTargetIndex: sagaDrag.dwellTargetIndex,
    groupDropReady: sagaDrag.dwellReady,
    add: (result: ApiSearchResult) => {
      if (sagaOrder.includes(result.externalId)) return;

      const duplicateTitleId = findDuplicateSagaTitleId(draft, sagaCtx, result.titleMain);
      if (duplicateTitleId) {
        const proceed = window.confirm(
          pe.saga_duplicate_confirm
            .replace('{title}', result.titleMain)
            .replace('{existingId}', duplicateTitleId)
            .replace('{newId}', result.externalId)
        );
        if (!proceed) return;
      }

      edit({ sagaOrder: [...sagaOrder, result.externalId] });
      setSagaMeta(prev => ({ ...prev, [result.externalId]: { title: result.titleMain, cover: result.coverUrl } }));
    },
    remove: (id: string) => {
      if (id === externalId) return; // this entry can move, not leave its own saga
      edit({ sagaOrder: sagaOrder.filter(x => x !== id) });
    },
    ungroup: (ids: string[]) => edit(d => ({ sagaGroups: ungroupSagaItems(d.sagaGroups, ids) })),
    setName: (name: string) => edit({ sagaName: name }),
  };

  // ── Editable relations (ADAPTATION, SPIN_OFF, ...) ─────────────────────────

  const editableDrag = useListReorder(editableRelations, next => edit({ editableRelations: next }));
  const editable = {
    ...editableDrag,
    add: (result: ApiSearchResult) => {
      if (!editableRelations.some(r => r.related_media_external_id === result.externalId)
        && !recommendations.some(r => r.external_id === result.externalId)) {
        // Type is picked afterward on the card's own select (same one shown
        // for pre-existing relations), not before adding — a default here is
        // just the starting point.
        edit({ editableRelations: [...editableRelations, {
          related_media_external_id: result.externalId,
          relation_type: DEFAULT_NEW_RELATION_TYPE,
          type_label: canonicalRelationLabels[DEFAULT_NEW_RELATION_TYPE] || DEFAULT_NEW_RELATION_TYPE,
          title: result.titleMain,
          cover: result.coverUrl,
        }] });
      }
    },
    updateType: (id: string, relationType: string) =>
      edit(d => ({ editableRelations: d.editableRelations.map(r => r.related_media_external_id === id
        ? { ...r, relation_type: relationType, type_label: canonicalRelationLabels[relationType] || relationType }
        : r) })),
    remove: (id: string) =>
      edit(d => ({ editableRelations: d.editableRelations.filter(r => r.related_media_external_id !== id) })),
  };

  // ── The five flat lists ────────────────────────────────────────────────────

  const addTo = (key: RelationListKey) => (result: ApiSearchResult) => edit(appendRelationPatch(key, result));
  const removeFrom = (key: RelationListKey) => (id: string) => edit(removeRelationPatch(key, id));

  const bundled = { ...useListReorder(bundledRelations, next => edit({ bundledRelations: next })), add: addTo('bundledRelations'), remove: removeFrom('bundledRelations') };
  const contained = { ...useListReorder(containedRelations, next => edit({ containedRelations: next })), add: addTo('containedRelations'), remove: removeFrom('containedRelations') };
  const bundleChild = {
    ...useListReorder(bundleChildren, next => edit({ bundleChildren: next })),
    add: (result: ApiSearchResult) => {
      if (result.externalId === externalId) return; // already implied by the Bundled In relation itself
      addTo('bundleChildren')(result);
    },
    remove: removeFrom('bundleChildren'),
  };
  const recommendation = {
    ...useListReorder(recommendations, next => edit({ recommendations: next })),
    add: (result: ApiSearchResult) => {
      // A title already related in some other way shouldn't also show up as a
      // recommendation for the same entry.
      if (editableRelations.some(r => r.related_media_external_id === result.externalId)) return;
      addTo('recommendations')(result);
    },
    remove: removeFrom('recommendations'),
  };
  const issue = { ...useListReorder(issueRelations, next => edit({ issueRelations: next })), remove: removeFrom('issueRelations') };

  // ── Cast ───────────────────────────────────────────────────────────────────

  const cast = {
    remove: (charExternalId: string) => edit({ characters: characters.filter(c => c.external_id !== charExternalId) }),
    add: (additions: DbMediaCharacter[]) => {
      if (additions.length) edit(d => ({ characters: [...d.characters, ...additions] }));
    },
  };

  return { saga, editable, bundled, contained, bundleChild, recommendation, issue, cast, canonicalRelationLabels };
}

export type PrEditorDraftActions = ReturnType<typeof usePrEditorDraftActions>;
