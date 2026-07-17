import type { SagaRelationType } from './sagaTypes';
import type { DbMediaRelation } from '../tauri/catalog';

export interface MediaMeta {
  title: string | null;
  cover: string | null;
}

export type MetaResolver = (id: string) => MediaMeta;

/** Builds a per-id metadata lookup: the current entry resolves to its own
 *  catalog fields, everything else falls back to the sagaMeta map (populated
 *  from either an existing relation row's title/cover, or a live API search
 *  result the user picked), finally to the bare id if nothing else is known. */
export function createMetaResolver(
  externalId: string,
  currentMeta: MediaMeta,
  sagaMeta: Record<string, MediaMeta>,
): MetaResolver {
  return (id: string): MediaMeta =>
    id === externalId ? currentMeta : (sagaMeta[id] ?? { title: null, cover: null });
}

export interface SagaGroupEntry {
  /** Representative id for this cluster — the first id encountered for a
   *  multi-id "Concept Group", or the id itself for a standalone entry. */
  mainId: string;
  /** Every id belonging to this cluster (only >1 for 'group' entries sharing a Concept Group name). */
  ids: string[];
  /** 'group' covers 'main' saga-relation-type ids; the other three are always standalone. */
  kind: 'group' | 'source' | 'episode' | 'update';
}

/** Walks the saga's chronological order once and clusters it into
 *  SagaGroupEntry buckets — 'main' ids sharing the same free-text Concept
 *  Group name collapse into a single 'group' entry, which is what makes them
 *  alternates of each other (so e.g. a console remaster and its PC original,
 *  or Inazuma Eleven 2's three versions, count as one step in the saga
 *  timeline instead of a chain of their own sequels/prequels), while
 *  'source'/'episode'/'update' ids always stay standalone. Shared by the
 *  editor's render (to draw group boxes) and by handleSubmit (to derive
 *  prequel/sequel + source/episode/update edges) — previously each kept its
 *  own slightly different copy of this walk. */
export function classifySagaChain(
  fullChain: string[],
  sagaRelationTypes: Record<string, SagaRelationType>,
  sagaGroups: Record<string, string>,
): SagaGroupEntry[] {
  const entries: SagaGroupEntry[] = [];
  const renderedGroupIds = new Set<string>();

  for (const id of fullChain) {
    const relType = sagaRelationTypes[id] || 'main';

    if (relType === 'main') {
      const rawGroupId = sagaGroups[id];
      const groupId = rawGroupId ? rawGroupId.trim().toLowerCase() : '';

      if (!groupId) {
        entries.push({ mainId: id, ids: [id], kind: 'group' });
        continue;
      }
      if (renderedGroupIds.has(groupId)) continue; // this cluster was already emitted

      const clusterIds = fullChain.filter(otherId => {
        const otherRelType = sagaRelationTypes[otherId] || 'main';
        const otherGroupId = sagaGroups[otherId];
        return otherRelType === 'main' &&
          !!otherGroupId && otherGroupId.trim().toLowerCase() === groupId;
      });
      renderedGroupIds.add(groupId);
      if (clusterIds.length > 0) {
        entries.push({ mainId: clusterIds[0], ids: clusterIds, kind: 'group' });
      }
    } else {
      entries.push({ mainId: id, ids: [id], kind: relType });
    }
  }

  return entries;
}

/** Reconstructs the saga's chronological order from previously-saved SEQUEL
 *  edges among `dateOrderedIds`, instead of trusting release dates alone.
 *
 *  handleSubmit walks whatever order the editor's sagaOrder state holds
 *  (release-date order, or a manually drag-reordered one) and writes a
 *  SEQUEL edge for every adjacent pair — but the *load* path used to always
 *  rebuild sagaOrder fresh from release dates on every open, discarding any
 *  saved reorder entirely. A manual reorder looked like it saved (the PR/
 *  local relations did update), but reopening the editor silently reverted
 *  the displayed order to release-date order every time.
 *
 *  Falls back to `dateOrderedIds` untouched when there are no SEQUEL edges
 *  yet (a fresh saga) or when the saved edges don't form a valid total
 *  order (shouldn't happen, but better to show *something* sensible than
 *  drop entries). Ties among ids with no edge constraint keep their
 *  relative release-date order for stability. */
export function reconstructSagaOrder(dateOrderedIds: string[], relsByIndex: DbMediaRelation[][]): string[] {
  const idSet = new Set(dateOrderedIds);
  const dateIndex = new Map(dateOrderedIds.map((id, i) => [id, i]));

  // precedes.get(A) = ids that a saved SEQUEL edge says come directly after A
  const precedes = new Map<string, Set<string>>();
  // Two alternates of the same Concept Group have no SEQUEL edge between
  // them (they're not sequential releases) — without some hint, Kahn's tie
  // break below always fell back to release-date order, silently reverting
  // a manual reorder within a group every time the editor reopened. See
  // PrEditorModal.tsx's own save logic for where this "#N" suffix comes
  // from (each alternate's own position within its Concept Group).
  const groupPosition = new Map<string, number>();
  const ALT_POSITION_RE = /#(\d+)$/;
  for (let i = 0; i < dateOrderedIds.length; i++) {
    for (const r of relsByIndex[i] ?? []) {
      if (r.relation_type === 'SEQUEL' && idSet.has(r.related_media_external_id)) {
        const ownerId = dateOrderedIds[i];
        if (!precedes.has(ownerId)) precedes.set(ownerId, new Set());
        precedes.get(ownerId)!.add(r.related_media_external_id);
      }
      if (r.relation_type === 'ALTERNATIVE') {
        const match = ALT_POSITION_RE.exec(r.type_label || '');
        if (match) groupPosition.set(dateOrderedIds[i], parseInt(match[1], 10));
      }
    }
  }
  if (precedes.size === 0) return dateOrderedIds; // nothing saved yet

  // Kahn's algorithm — ties (no edge constraint between two ready ids) break
  // by release-date order so the result stays deterministic and sensible.
  const inDegree = new Map(dateOrderedIds.map(id => [id, 0]));
  for (const targets of precedes.values()) {
    for (const t of targets) inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
  }

  const ready = dateOrderedIds.filter(id => inDegree.get(id) === 0);
  const result: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => {
      const ga = groupPosition.get(a);
      const gb = groupPosition.get(b);
      if (ga !== undefined && gb !== undefined) return ga - gb;
      return dateIndex.get(a)! - dateIndex.get(b)!;
    });
    const id = ready.shift()!;
    result.push(id);
    for (const next of precedes.get(id) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }

  // A cycle or other inconsistency in the saved edges — fall back rather
  // than silently dropping whichever ids didn't make it into `result`.
  return result.length === dateOrderedIds.length ? result : dateOrderedIds;
}
