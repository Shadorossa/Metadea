// Pure grouping logic for the library grid, split out of LibrarySection.tsx.
// Three passes, each building on the previous one's output:
//   groupEditions   -> collapses remakes/remasters/ports under one slot
//   groupBundles    -> collapses a container's owned parts into one card
//   refineSagaGroups -> merges standalone groups belonging to the same saga
import type { MediaCatalogEntry, DbMediaRelation, LibraryEntry } from '../../lib/tauri';
import { compareByReleaseDate } from '../../lib/media/mapper-utils';
import { CONTAINS_RELATION_TYPES } from '../../lib/media/sagaTypes';

// Groups editions of the same work (remakes, remasters, ports) under one
// grid slot. Gated behind "Agrupar por ediciones"; saga grouping is separate
// (refineSagaGroups) since it must bridge works the user doesn't own.
export function groupEditions<T extends { external_id: string; selected_version: string | null; type: string }>(
  sectionItems: T[],
  catalogMap: Map<string, MediaCatalogEntry>,
  includeEditions: boolean,
): Array<{ item: T; grouped: T[] }> {
  const byId = new Map(sectionItems.map(i => [i.external_id, i]));
  const parentOf = new Map<string, string>();

  if (includeEditions) {
    for (const item of sectionItems) {
      const linkedIds = item.selected_version ? item.selected_version.split(',').map(s => s.trim()).filter(Boolean) : [];
      for (const linkedId of linkedIds) {
        if (linkedId !== item.external_id && byId.has(linkedId)) parentOf.set(linkedId, item.external_id);
      }
    }

    for (const item of sectionItems) {
      if (parentOf.has(item.external_id)) continue;
      const catalogParentId = catalogMap.get(item.external_id)?.parent_id;
      if (catalogParentId && catalogParentId !== item.external_id && byId.has(catalogParentId)) {
        parentOf.set(item.external_id, catalogParentId);
      }
    }
  }

  const rootOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur)!;
    }
    return cur;
  };

  // Flatten multi-level chains (e.g. Rebirth → Remake → Original) so every entry points at the ultimate root.
  for (const id of [...parentOf.keys()]) {
    parentOf.set(id, rootOf(id));
  }

  const out: Array<{ item: T; grouped: T[] }> = [];
  for (const item of sectionItems) {
    if (parentOf.has(item.external_id)) continue; // rendered nested under its parent instead
    const grouped = sectionItems.filter(other => parentOf.get(other.external_id) === item.external_id);
    out.push({ item, grouped });
  }

  return out;
}

// Second pass: collapses groups a CONTAINS/EPISODE relation ties to one
// container into a single card with the container's cover/title. Goes by
// the relation itself, not the container's `format`, since that can be
// stale; needs 2+ owned contents plus the container itself already cataloged.
export function groupBundles<T extends { external_id: string }>(
  groups: Array<{ item: T; grouped: T[] }>,
  catalogMap: Map<string, MediaCatalogEntry>,
  relations: DbMediaRelation[],
): Array<{ item: T; grouped: T[]; bundleMeta?: MediaCatalogEntry }> {
  const rootIndexOf = new Map<string, number>();
  groups.forEach((g, i) => {
    rootIndexOf.set(g.item.external_id, i);
    for (const child of g.grouped) rootIndexOf.set(child.external_id, i);
  });

  // containerOf[childId] = its container — flattened below to the ultimate
  // top-level container (same rootOf technique as groupEditions) so a
  // bundle-of-a-bundle (A contains B, B contains D/E) collapses into one
  // card under A instead of B also showing as its own separate bundle.
  const containerOf = new Map<string, string>();
  for (const rel of relations) {
    if (!rel.media_external_id || !CONTAINS_RELATION_TYPES.includes(rel.relation_type)) continue;
    containerOf.set(rel.related_media_external_id, rel.media_external_id);
  }
  const ultimateContainerOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (containerOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = containerOf.get(cur)!;
    }
    return cur;
  };
  for (const id of [...containerOf.keys()]) {
    containerOf.set(id, ultimateContainerOf(id));
  }

  const childIdsByContainer = new Map<string, string[]>();
  for (const [childId, containerId] of containerOf) {
    const list = childIdsByContainer.get(containerId) ?? [];
    list.push(childId);
    childIdsByContainer.set(containerId, list);
  }

  const consumed = new Set<number>();
  const bundleGroups: Array<{ item: T; grouped: T[]; bundleMeta: MediaCatalogEntry }> = [];

  for (const [containerId, childIds] of childIdsByContainer) {
    const catalogEntry = catalogMap.get(containerId);
    if (!catalogEntry) continue;

    // Counted by matched children, not root-group indices — an earlier saga
    // pass can fuse two contained works into one root group already.
    const matchedChildIds = new Set(
      childIds.filter(id => {
        const idx = rootIndexOf.get(id);
        return idx !== undefined && !consumed.has(idx);
      })
    );
    if (matchedChildIds.size < 2) continue;

    const matchedRootIndices = new Set([...matchedChildIds].map(id => rootIndexOf.get(id)!));

    const merged: T[] = [];
    let representative: T | null = null;
    for (const idx of matchedRootIndices) {
      const g = groups[idx];
      if (!representative) representative = g.item;
      merged.push(g.item, ...g.grouped);
      consumed.add(idx);
    }
    bundleGroups.push({ item: representative!, grouped: merged, bundleMeta: catalogEntry });
  }

  const remaining = groups.filter((_, i) => !consumed.has(i));
  return [...remaining, ...bundleGroups];
}

// Games (IGDB) carry real SEQUEL/PREQUEL rows too, not just AniList types.
const SAGA_GROUPABLE_TYPES = new Set(['anime', 'manga', 'lnovel', 'game', 'vnovel']);

// Third pass: merges standalone groups belonging to the same saga, walking
// the WHOLE catalog's PREQUEL/SEQUEL graph (not just relations between owned
// entries) so a gap (owning 1,2,3,5 but not 4) doesn't strand 5 on its own.
// Only touches bare singletons — edition/bundle cards keep their own look.
export function refineSagaGroups<T extends { external_id: string }>(
  groups: Array<{ item: T; grouped: T[]; bundleMeta?: MediaCatalogEntry }>,
  catalogMap: Map<string, MediaCatalogEntry>,
  relations: DbMediaRelation[],
  sagaNames: Record<string, string>,
): Array<{ item: T; grouped: T[]; bundleMeta?: MediaCatalogEntry; titleOverride?: string; aggregateStats?: boolean }> {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let cur = id;
    while (parent.get(cur) !== cur) cur = parent.get(cur)!;
    return cur;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const rel of relations) {
    // SECUELA/PRECUELA: pre-fix Spanish labels some libraries still have on disk.
    // ALTERNATIVE: classifySagaChain's Concept Group edge — a saga step without an order.
    const isSequel  = rel.relation_type === 'SEQUEL'  || rel.relation_type === 'SECUELA';
    const isPrequel = rel.relation_type === 'PREQUEL' || rel.relation_type === 'PRECUELA';
    const isAlternative = rel.relation_type === 'ALTERNATIVE';
    if (!isSequel && !isPrequel && !isAlternative) continue;
    if (!rel.media_external_id) continue;
    const a = rel.media_external_id;
    const b = rel.related_media_external_id;
    const typeA = catalogMap.get(a)?.type;
    const typeB = catalogMap.get(b)?.type;
    if (typeA && !SAGA_GROUPABLE_TYPES.has(typeA)) continue;
    if (typeB && !SAGA_GROUPABLE_TYPES.has(typeB)) continue;
    union(a, b);
  }

  // A bundle member (either side of EPISODE/PART_OF) never joins a saga
  // cluster, even with "Agrupar por bundle" off (bundleMeta unset then).
  const bundleParticipantIds = new Set<string>();
  for (const rel of relations) {
    if (!rel.media_external_id || !CONTAINS_RELATION_TYPES.includes(rel.relation_type)) continue;
    bundleParticipantIds.add(rel.media_external_id);
    bundleParticipantIds.add(rel.related_media_external_id);
  }

  // An edition-fused group still joins the saga cluster if either member touches the graph. Bundles are excluded.
  const byComponent = new Map<string, number[]>();
  groups.forEach((g, i) => {
    if (g.bundleMeta) return;
    const memberIds = [g.item.external_id, ...g.grouped.map(m => m.external_id)];
    if (memberIds.some(id => bundleParticipantIds.has(id))) return;
    const rootId = memberIds.find(id => parent.has(id));
    if (!rootId) return;
    const comp = find(rootId);
    const list = byComponent.get(comp) ?? [];
    list.push(i);
    byComponent.set(comp, list);
  });

  const consumed = new Set<number>();
  const sagaGroups: Array<{ item: T; grouped: T[]; titleOverride?: string; aggregateStats: boolean }> = [];

  for (const indices of byComponent.values()) {
    if (indices.length < 2) continue; // nothing to merge — leave the lone entry exactly as-is

    const allMembers: T[] = [];
    for (const idx of indices) {
      const g = groups[idx];
      allMembers.push(g.item, ...g.grouped);
      consumed.add(idx);
    }

    // Earliest release first — the group sits over its first work.
    const sorted = [...allMembers].sort((a, b) =>
      compareByReleaseDate(catalogMap.get(a.external_id) ?? {}, catalogMap.get(b.external_id) ?? {})
    );
    const [rep, ...rest] = sorted;
    const sagaName = allMembers.map(m => sagaNames[m.external_id]).find(Boolean);
    sagaGroups.push({ item: rep, grouped: rest, titleOverride: sagaName, aggregateStats: true });
  }

  const remaining = groups.filter((_, i) => !consumed.has(i));
  return [...remaining, ...sagaGroups];
}

// Averages the ratings of every work a bundle groups together, ignoring
// unrated ones — e.g. Adventures rated 8, Resolve unrated → the bundle
// shows 8, not a skewed average against a missing score.
export function averageRating(entries: LibraryEntry[]): number | null {
  const rated = entries.map(e => e.rating).filter((r): r is number => r != null);
  if (rated.length === 0) return null;
  return rated.reduce((a, b) => a + b, 0) / rated.length;
}
