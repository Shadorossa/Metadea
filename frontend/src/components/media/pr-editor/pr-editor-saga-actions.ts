// Pure saga-chain edits for PrEditorModal (grouping alternate versions,
// duplicate-title detection) — each takes the draft and returns the patch
// the modal dispatches, so the modal keeps only the wiring.
import type { MediaMeta } from '../../../lib/media/saga/saga-grouping';
import { moveItem } from '../../../lib/shared/collections/move-item';
import type { PrEditorDraft } from './pr-editor-state';

export interface SagaActionContext {
  externalId: string;
  // Display-only metadata (cover/title/year) for saga members other than
  // this entry.
  sagaMeta: Record<string, MediaMeta>;
}

// Catches a *different* id with the same title (e.g. duplicate IGDB entries
// per platform) — the caller confirms rather than blocking outright, since
// two different works can coincidentally share a title.
export function findDuplicateSagaTitleId(draft: PrEditorDraft, ctx: SagaActionContext, title: string): string | undefined {
  const normalizedTitle = title.trim().toLowerCase();
  return draft.sagaOrder.find(id => {
    const existingTitle = id === ctx.externalId ? draft.entry?.title_main : ctx.sagaMeta[id]?.title;
    return existingTitle?.trim().toLowerCase() === normalizedTitle;
  });
}

function groupMembers(draft: PrEditorDraft, sourceId: string, targetId: string): Set<string> {
  const { sagaOrder, sagaGroups } = draft;
  const sourceGroup = sagaGroups[sourceId]?.trim();
  const targetGroup = sagaGroups[targetId]?.trim();
  const members = new Set([sourceId, targetId]);
  if (sourceGroup) {
    sagaOrder.filter(id => sagaGroups[id]?.trim() === sourceGroup).forEach(id => members.add(id));
  }
  if (targetGroup) {
    sagaOrder.filter(id => sagaGroups[id]?.trim() === targetGroup).forEach(id => members.add(id));
  }
  return members;
}

// Two 'main' entries from the same release year can be grouped as alternate
// versions of each other — and every existing member of either side's group
// has to share that year too.
export function canGroupSagaItems(draft: PrEditorDraft, ctx: SagaActionContext, fromIndex: number, toIndex: number): boolean {
  const { sagaOrder, sagaRelationTypes } = draft;
  const sourceId = sagaOrder[fromIndex];
  const targetId = sagaOrder[toIndex];
  if (!sourceId || !targetId || sourceId === targetId) return false;

  const sourceRole = sagaRelationTypes[sourceId] || 'main';
  const targetRole = sagaRelationTypes[targetId] || 'main';
  if (sourceRole !== 'main' || targetRole !== 'main') return false;

  const yearOf = (id: string) => id === ctx.externalId ? draft.entry?.release_year ?? null : ctx.sagaMeta[id]?.release_year ?? null;
  const sourceYear = yearOf(sourceId);
  const targetYear = yearOf(targetId);
  if (sourceYear == null || targetYear == null || sourceYear !== targetYear) return false;

  return [...groupMembers(draft, sourceId, targetId)].every(id => yearOf(id) != null && yearOf(id) === sourceYear);
}

// Joins the dragged item into the target's group (or the source's, or a
// fresh one) and moves it next to the target. Null when not groupable.
export function groupSagaItems(draft: PrEditorDraft, ctx: SagaActionContext, fromIndex: number, toIndex: number): Pick<PrEditorDraft, 'sagaGroups' | 'sagaOrder'> | null {
  if (!canGroupSagaItems(draft, ctx, fromIndex, toIndex)) return null;
  const { sagaOrder, sagaGroups } = draft;
  const sourceId = sagaOrder[fromIndex];
  const targetId = sagaOrder[toIndex];
  const sourceGroup = sagaGroups[sourceId]?.trim();
  const targetGroup = sagaGroups[targetId]?.trim();
  const group = targetGroup || sourceGroup || `Alternative ${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${fromIndex}-${toIndex}`}`;

  const nextGroups = { ...sagaGroups };
  groupMembers(draft, sourceId, targetId).forEach(id => { nextGroups[id] = group; });
  return { sagaGroups: nextGroups, sagaOrder: moveItem(sagaOrder, fromIndex, toIndex) ?? sagaOrder };
}

export function ungroupSagaItems(sagaGroups: Record<string, string>, ids: string[]): Record<string, string> {
  const next = { ...sagaGroups };
  ids.forEach(id => { delete next[id]; });
  return next;
}
