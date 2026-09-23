import type { DbMediaRelation, CatalogSummary } from '../tauri';
import { isSagaComponentRelationType, SAGA_GROUPABLE_TYPES } from '../media/saga/saga-relation-types';
import { createUnionFind, type UnionFind } from '../shared/collections/union-find';

export interface DirectSagaGraph {
  graph: UnionFind<string>;
  directIds: Set<string>;
}

/**
 * Builds the direct saga graph shared by library grouping and profile stats.
 * Edition folding and status-specific grouping remain in their callers.
 */
export function buildDirectSagaGraph(
  relations: DbMediaRelation[],
  catalogMap: Map<string, CatalogSummary>,
): DirectSagaGraph {
  const graph = createUnionFind<string>();
  const directIds = new Set<string>();

  for (const rel of relations) {
    if (!rel.media_external_id || !isSagaComponentRelationType(rel.relation_type)) continue;

    const a = rel.media_external_id;
    const b = rel.related_media_external_id;
    const typeA = catalogMap.get(a)?.type;
    const typeB = catalogMap.get(b)?.type;
    if (typeA && !SAGA_GROUPABLE_TYPES.has(typeA)) continue;
    if (typeB && !SAGA_GROUPABLE_TYPES.has(typeB)) continue;

    graph.union(a, b);
    directIds.add(a);
    directIds.add(b);
  }

  return { graph, directIds };
}
