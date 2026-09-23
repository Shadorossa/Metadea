// Every list-editing handler PrEditorModal's tabs need (add/remove/reorder
// on each relation list, the saga chain, the cast), built over the modal's
// own `edit` dispatch. State stays in the modal's reducer; this only turns
// UI events into draft patches, plus the `sortable` actions each list hands
// to the shared SortableList (mouse and keyboard reordering).
import type { SearchResult as ApiSearchResult } from '../../../lib/search';
import type { DbMediaCharacter } from '../../../lib/tauri/characters';
import type { MediaMeta } from '../../../lib/media/saga/saga-grouping';
import type { Translations } from '../../../i18n/index';
import { CANONICAL_RELATION_LABELS } from '../../../lib/media/saga/canonical-relations';
import { moveItem } from '../../../lib/shared/collections/move-item';
import type { SortableListActions } from '../../shared/SortableList';
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

// Reorder-only actions for a list whose only reorder path is the drag itself.
// Lists that also reorder from elsewhere (the saga chain, whose grouping drop
// reorders as part of a larger update) build their own actions.
type ReorderableListKey = RelationListKey | 'editableRelations' | 'sagaOrder';

const reorderListPatch = (key: ReorderableListKey, fromIndex: number, toIndex: number): PrEditorDraftPatch => draft => {
  const next = moveItem<unknown>(draft[key], fromIndex, toIndex);
  return next ? { [key]: next } : {};
};

interface Params {
  pe: Translations['pr_editor'];
  externalId: string;
  draft: PrEditorDraft;
  edit: (patch: PrEditorDraftPatch) => void;
  sagaMeta: Record<string, MediaMeta>;
  setSagaMeta: React.Dispatch<React.SetStateAction<Record<string, MediaMeta>>>;
}

export function usePrEditorDraftActions({ pe, externalId, draft, edit, sagaMeta, setSagaMeta }: Params) {
  const { sagaOrder, editableRelations, recommendations, characters } = draft;
  const sagaCtx = { externalId, sagaMeta };
  // Also what the Relations dropdown itself displays (not just what gets
  // persisted) — a curator's own UI language shouldn't decide what a PR
  // reviewer in a different language sees on that same option, and this is
  // the exact text that ends up in type_label (see updateType below), so
  // showing anything else here would just be misleading.
  const canonicalRelationLabels = CANONICAL_RELATION_LABELS;

  // ── Saga ───────────────────────────────────────────────────────────────────

  const sortableFor = (key: ReorderableListKey): SortableListActions => ({
    onReorder: (fromIndex, toIndex) => edit(reorderListPatch(key, fromIndex, toIndex)),
  });
  const sagaSortable: SortableListActions = {
    onReorder: (fromIndex, toIndex) => edit(reorderListPatch('sagaOrder', fromIndex, toIndex)),
    // Dropping after dwelling on (or pressing G over) another work groups the
    // two as alternate versions instead of reordering.
    onGroup: (fromIndex, toIndex) => {
      const grouped = groupSagaItems(draft, sagaCtx, fromIndex, toIndex);
      if (grouped) edit(grouped);
    },
    canGroup: (fromIndex, toIndex) => canGroupSagaItems(draft, sagaCtx, fromIndex, toIndex),
  };
  const saga = {
    sortable: sagaSortable,
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

  const editable = {
    sortable: sortableFor('editableRelations'),
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

  const bundled = { sortable: sortableFor('bundledRelations'), add: addTo('bundledRelations'), remove: removeFrom('bundledRelations') };
  const contained = { sortable: sortableFor('containedRelations'), add: addTo('containedRelations'), remove: removeFrom('containedRelations') };
  const bundleChild = {
    sortable: sortableFor('bundleChildren'),
    add: (result: ApiSearchResult) => {
      if (result.externalId === externalId) return; // already implied by the Bundled In relation itself
      addTo('bundleChildren')(result);
    },
    remove: removeFrom('bundleChildren'),
  };
  const recommendation = {
    sortable: sortableFor('recommendations'),
    add: (result: ApiSearchResult) => {
      // A title already related in some other way shouldn't also show up as a
      // recommendation for the same entry.
      if (editableRelations.some(r => r.related_media_external_id === result.externalId)) return;
      addTo('recommendations')(result);
    },
    remove: removeFrom('recommendations'),
  };
  const issue = { sortable: sortableFor('issueRelations'), remove: removeFrom('issueRelations') };

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
