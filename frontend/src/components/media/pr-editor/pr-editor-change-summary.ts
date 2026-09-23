// buildChangeSummary, split out of PrEditorModal.tsx: formats the "- " PR
// body. buildPrEditorChangeSummary derives everything from the editor state;
// formatPrEditorChangeSummary is the pure formatter underneath it, taking
// precomputed values so it can be exercised directly.
import type { MediaCatalogEntry } from '../../../lib/tauri/catalog';
import type { MediaMeta } from '../../../lib/media/saga/saga-grouping';
import type { SagaRelationType } from '../../../lib/media/saga/saga-relation-types';
import { DIFF_FIELDS } from '../../../lib/media/constants';
import type { BundledRelation, EditableRelation } from '../../../lib/media/editor/pr-editor-types';
import {
  charactersChanged, getPrEditorDiff, isFieldChanged, originalEditableRelationTypes,
  type PrEditorContext, type PrEditorState,
} from './pr-editor-state';

export interface PrEditorChangeSummaryDiff {
  addedBundled: BundledRelation[];
  removedBundledIds: string[];
  addedContained: BundledRelation[];
  removedContainedIds: string[];
  addedEditableRelations: EditableRelation[];
  removedEditableRelationIds: string[];
  changedEditableRelations: EditableRelation[];
  addedSaga: string[];
  removedSaga: string[];
  sagaOrderChanged: boolean;
  relTypesChanged: boolean;
  groupsChanged: boolean;
  sagaNameChanged: boolean;
}

export interface BuildChangeSummaryParams {
  entry: MediaCatalogEntry;
  originalEntry: MediaCatalogEntry | null;
  isFieldChanged: (field: keyof MediaCatalogEntry) => boolean;
  diff: PrEditorChangeSummaryDiff;
  resolveMeta: (id: string) => MediaMeta;
  originalEditableRelationTypes: Map<string, string>;
  sagaOrder: string[];
  sagaRelationTypes: Record<string, SagaRelationType>;
  sagaName: string;
  originalSagaName: string;
  charactersChanged: boolean;
  charactersCount: number;
  mediaAuthorsCount: number;
}

// "- " bullet list of everything this proposal adds or changes, used as the
// PR body — derived from the editor state. Empty when no entry is loaded.
export function buildPrEditorChangeSummary(state: PrEditorState, ctx: PrEditorContext, resolveMeta: (id: string) => MediaMeta): string {
  const { draft, baseline } = state;
  if (!draft.entry) return '';
  return formatPrEditorChangeSummary({
    entry: draft.entry,
    originalEntry: baseline.entry,
    isFieldChanged: field => isFieldChanged(state, field),
    diff: getPrEditorDiff(state, ctx),
    resolveMeta,
    originalEditableRelationTypes: originalEditableRelationTypes(state),
    sagaOrder: draft.sagaOrder,
    sagaRelationTypes: draft.sagaRelationTypes,
    sagaName: draft.sagaName,
    originalSagaName: baseline.sagaName,
    charactersChanged: charactersChanged(state),
    charactersCount: draft.characters.length,
    mediaAuthorsCount: draft.mediaAuthors.length,
  });
}

export function formatPrEditorChangeSummary(p: BuildChangeSummaryParams): string {
  const { entry, originalEntry, isFieldChanged, diff: d, resolveMeta, originalEditableRelationTypes, sagaOrder, sagaRelationTypes, sagaName, originalSagaName } = p;
  const lines: string[] = [];

  // null and undefined both mean "not blocked": a new entry (no original)
  // carrying an explicit `blocked_at: null` must not read as "Unblocked".
  if ((entry.blocked_at ?? null) !== (originalEntry?.blocked_at ?? null)) {
    lines.push(entry.blocked_at ? '- Blocked (hidden from Metadea)' : '- Unblocked (restored to Metadea)');
  }

  const formatFieldVal = (v: any) => {
    const s = String(v ?? '');
    if (s.startsWith('data:')) return '(imagen base64)';
    return s.length > 150 ? `${s.slice(0, 150)}...` : s;
  };

  for (const [field, label] of DIFF_FIELDS) {
    if (!isFieldChanged(field)) continue;
    const before = originalEntry?.[field] ?? null;
    const after = entry[field] ?? null;
    if (before == null || before === '') lines.push(`- Added ${label}: "${formatFieldVal(after)}"`);
    else if (after == null || after === '') lines.push(`- Removed ${label} (was "${formatFieldVal(before)}")`);
    else lines.push(`- Changed ${label}: "${formatFieldVal(before)}" → "${formatFieldVal(after)}"`);
  }

  const formatWork = (id: string, title?: string | null): string => {
    const displayTitle = title || resolveMeta(id).title;
    return displayTitle ? `${displayTitle} (${id})` : id;
  };

  for (const r of d.addedBundled) lines.push(`- Added Bundled In: ${formatWork(r.external_id, r.title)}`);
  for (const id of d.removedBundledIds) lines.push(`- Removed Bundled In: ${formatWork(id)}`);
  for (const r of d.addedContained) lines.push(`- Added Contains: ${formatWork(r.external_id, r.title)}`);
  for (const id of d.removedContainedIds) lines.push(`- Removed Contains: ${formatWork(id)}`);
  for (const r of d.addedEditableRelations) lines.push(`- Added Relation: ${formatWork(r.related_media_external_id, r.title)} (${r.type_label})`);
  for (const id of d.removedEditableRelationIds) lines.push(`- Removed Relation: ${formatWork(id)}`);
  for (const r of d.changedEditableRelations) {
    const before = originalEditableRelationTypes.get(r.related_media_external_id) ?? '';
    lines.push(`- Changed Relation Type: ${formatWork(r.related_media_external_id, r.title)} (${before} → ${r.relation_type})`);
  }

  if (d.addedSaga.length > 0 || d.removedSaga.length > 0 || d.sagaOrderChanged || d.relTypesChanged || d.groupsChanged || d.sagaNameChanged) {
    if (d.sagaNameChanged) {
      lines.push(`- Changed Saga Name: "${originalSagaName}" → "${sagaName}"`);
    }
    for (const id of d.addedSaga) {
      lines.push(`- Added to Saga: ${formatWork(id)} [type: ${sagaRelationTypes[id] || 'main'}]`);
    }
    for (const id of d.removedSaga) {
      lines.push(`- Removed from Saga: ${formatWork(id)}`);
    }
    if (d.sagaOrderChanged) {
      const chainLabel = sagaOrder.map(id => `${formatWork(id)} [type: ${sagaRelationTypes[id] || 'main'}]`).join(' → ');
      lines.push(d.addedSaga.length === 0 && d.removedSaga.length === 0
        ? `- Reordered Saga: ${chainLabel}`
        : `- Saga order: ${chainLabel}`);
    } else if (d.relTypesChanged || d.groupsChanged) {
      lines.push(`- Updated Saga relations/groups`);
    }
  }

  if (p.charactersChanged) lines.push(`- Characters: ${p.charactersCount} character(s)`);
  else if (p.charactersCount > 0) lines.push(`- Includes ${p.charactersCount} cached character(s)`);
  if (p.mediaAuthorsCount > 0) lines.push(`- Includes ${p.mediaAuthorsCount} cached author/staff credit(s)`);

  return lines.length > 0 ? lines.join('\n') : '- No field changes detected (metadata refresh only)';
}
