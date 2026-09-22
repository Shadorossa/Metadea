import type { SagaRelationType } from './sagaTypes';
import type { DbMediaRelation } from '../tauri/catalog';

export interface MediaMeta {
  title: string | null;
  cover: string | null;
  release_year?: number | null;
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

/** Clusters the saga's chronological order into SagaGroupEntry buckets:
 *  'main' ids sharing the same free-text Concept Group name collapse into one
 *  'group' entry (alternates — a remaster and its original count as one saga
 *  step, not a sequel/prequel of each other); 'source'/'episode'/'update' ids
 *  always stay standalone. Shared by the editor's render and handleSubmit's
 *  edge derivation, which used to each keep a slightly different copy. */
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

// Kahn's algorithm over an arbitrary "A must come before B" edge set — ties
// (no edge constraint between two ready ids) break via the caller's own
// tieBreak, so this serves both the local-relations reconstruction below
// (release-date + manual in-group position) and fetchAniListSaga's live BFS
// (release-date only, no group-position concept there). A cycle or other
// inconsistency in the edges falls back to `ids` as given rather than
// silently dropping whichever ones didn't make it into `result`.
export function topoSortByPrecedes(
  ids: string[],
  precedes: Map<string, Set<string>>,
  tieBreak: (a: string, b: string) => number,
): string[] {
  if (precedes.size === 0) return ids;

  const inDegree = new Map(ids.map(id => [id, 0]));
  for (const targets of precedes.values()) {
    for (const t of targets) inDegree.set(t, (inDegree.get(t) ?? 0) + 1);
  }

  const ready = ids.filter(id => inDegree.get(id) === 0);
  const result: string[] = [];
  while (ready.length > 0) {
    ready.sort(tieBreak);
    const id = ready.shift()!;
    result.push(id);
    for (const next of precedes.get(id) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) ready.push(next);
    }
  }

  return result.length === ids.length ? result : ids;
}

/** Reconstructs saga order from saved SEQUEL/PREQUEL edges instead of
 *  trusting release dates alone — without this, reopening the editor after a
 *  manual drag-reorder silently reverted to release-date order every time,
 *  even though the save itself had gone through fine. Falls back to
 *  `dateOrderedIds` when there are no usable edges yet or they don't form a
 *  valid order; unconstrained ties keep release-date order. */
export function reconstructSagaOrder(dateOrderedIds: string[], relsByIndex: DbMediaRelation[][]): string[] {
  const idSet = new Set(dateOrderedIds);
  const dateIndex = new Map(dateOrderedIds.map((id, i) => [id, i]));

  // precedes.get(A) = ids that come directly after A, from either a saved
  // SEQUEL edge on A's own row or a PREQUEL edge on the OTHER entry's row
  // pointing back at A — relations aren't always saved on both sides (an
  // older sync, a manually-curated single edge, ...), so an A->B PREQUEL-
  // only edge has to count exactly the same as a B->A SEQUEL edge would, or
  // that pair silently falls through to release-date order instead (which
  // is exactly wrong when the two didn't release in story order — e.g. a
  // pair of movies/OVAs numbered "Semi-Final"/"Final" or similar). Also
  // covers the pre-fix Spanish labels (SECUELA/PRECUELA) some libraries
  // still have on disk, same as every other relation-type consumer in this
  // app (library-grouping.ts, LibrarySection.tsx) already does — this was
  // the one place still checking 'SEQUEL' alone.
  const precedes = new Map<string, Set<string>>();
  const addPrecedes = (earlierId: string, laterId: string) => {
    if (!precedes.has(earlierId)) precedes.set(earlierId, new Set());
    precedes.get(earlierId)!.add(laterId);
  };
  // Two alternates of the same group have no SEQUEL edge between them, so
  // without this hint Kahn's tie-break below fell back to release-date order
  // and silently reverted a manual in-group reorder. "#N" is each
  // alternate's position within its group (see PrEditorModal.tsx's save logic).
  const groupPosition = new Map<string, number>();
  const ALT_POSITION_RE = /#(\d+)$/;
  for (let i = 0; i < dateOrderedIds.length; i++) {
    const ownerId = dateOrderedIds[i];
    for (const r of relsByIndex[i] ?? []) {
      if (r.relation_type === 'ALTERNATIVE') {
        const match = ALT_POSITION_RE.exec(r.type_label || '');
        if (match) groupPosition.set(ownerId, parseInt(match[1], 10));
        continue;
      }
      if (!idSet.has(r.related_media_external_id)) continue;
      if (r.relation_type === 'SEQUEL' || r.relation_type === 'SECUELA') {
        addPrecedes(ownerId, r.related_media_external_id);
      } else if (r.relation_type === 'PREQUEL' || r.relation_type === 'PRECUELA') {
        addPrecedes(r.related_media_external_id, ownerId);
      }
    }
  }

  return topoSortByPrecedes(dateOrderedIds, precedes, (a, b) => {
    const ga = groupPosition.get(a);
    const gb = groupPosition.get(b);
    if (ga !== undefined && gb !== undefined) return ga - gb;
    return dateIndex.get(a)! - dateIndex.get(b)!;
  });
}

/** Restricts `ids` to only those reachable from `startId` by walking
 *  PREQUEL/SEQUEL edges alone — get_transitive_relation_ids' own closure
 *  (used by both this and PrEditorModal's Concept Group clustering) also
 *  pulls in ALTERNATIVE-linked entries (uncut/TV-cut versions of the same
 *  season, alternate edits) and other relation types, which are exactly what
 *  PrEditorModal's own "Concept Group" editing needs them for — but a
 *  Temporadas tab or unifyAnimeSeasons fusion must never show one of those
 *  as if it were its own separate season, so sagaData.ts's chain-building
 *  filters through this before returning entries, while PrEditorModal itself
 *  keeps consuming the full unfiltered closure. */
export function filterToSequelChain(ids: string[], relsByIndex: DbMediaRelation[][], startId: string): string[] {
  const idSet = new Set(ids);
  const adjacency = new Map<string, Set<string>>();
  for (let i = 0; i < ids.length; i++) {
    for (const r of relsByIndex[i] ?? []) {
      if ((r.relation_type === 'PREQUEL' || r.relation_type === 'SEQUEL') && idSet.has(r.related_media_external_id)) {
        const a = ids[i], b = r.related_media_external_id;
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        if (!adjacency.has(b)) adjacency.set(b, new Set());
        adjacency.get(a)!.add(b);
        adjacency.get(b)!.add(a);
      }
    }
  }

  const reachable = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of adjacency.get(cur) ?? []) {
      if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
  }

  return ids.filter(id => reachable.has(id));
}
