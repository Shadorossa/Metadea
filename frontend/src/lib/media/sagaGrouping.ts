import type { SagaRelationType } from './sagaTypes';

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
  /** 'group' covers both 'main' and 'alternative' saga-relation-type ids; the other three are always standalone. */
  kind: 'group' | 'source' | 'episode' | 'update';
}

/** Walks the saga's chronological order once and clusters it into
 *  SagaGroupEntry buckets — 'main'/'alternative' ids sharing the same
 *  free-text Concept Group name collapse into a single 'group' entry (so
 *  e.g. a console remaster and its PC original count as one step in the
 *  saga timeline), while 'source'/'episode'/'update' ids always stay
 *  standalone. Shared by the editor's render (to draw group boxes) and by
 *  handleSubmit (to derive prequel/sequel + source/episode/update edges) —
 *  previously each kept its own slightly different copy of this walk. */
export function classifySagaChain(
  fullChain: string[],
  sagaRelationTypes: Record<string, SagaRelationType>,
  sagaGroups: Record<string, string>,
): SagaGroupEntry[] {
  const entries: SagaGroupEntry[] = [];
  const renderedGroupIds = new Set<string>();

  for (const id of fullChain) {
    const relType = sagaRelationTypes[id] || 'main';

    if (relType === 'main' || relType === 'alternative') {
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
        return (otherRelType === 'main' || otherRelType === 'alternative') &&
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
