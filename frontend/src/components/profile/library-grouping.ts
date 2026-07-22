// Pure grouping logic for the library grid, split out of LibrarySection.tsx.
// Three passes, each building on the previous one's output:
//   groupEditions   -> collapses remakes/remasters/ports under one slot
//   groupBundles    -> collapses a container's owned parts into one card
//   refineSagaGroups -> merges standalone groups belonging to the same saga
import type { MediaCatalogEntry, DbMediaRelation, LibraryEntry } from '../../lib/tauri';
import { compareByReleaseDate } from '../../lib/media/mapper-utils';
import { CONTAINS_RELATION_TYPES } from '../../lib/media/sagaTypes';

// Groups library entries that are editions of one another (remakes,
// remasters, ports, ...) under a single "slot" so they don't each claim a
// spot in the grid. Gated entirely behind "Agrupar por ediciones" — sequel/
// prequel (saga) grouping used to also live here, but now runs separately
// in refineSagaGroups (see its own doc for why: an edition link only ever
// connects two owned entries directly, which is fine for editions, but a
// saga needs to bridge across works the user doesn't own at all).
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

  // Flatten multi-level chains (e.g. Rebirth → Remake → Original, from two
  // separate direct parent_id edges) so every entry in the chain ends up
  // pointing straight at the same ultimate root.
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

// Second pass, on top of groupEditions' output: collapses the root-groups
// for whatever a CONTAINS relation (EPISODE, from the container's own row —
// e.g. "Chronicles" containing "Adventures" and "2: Resolve") groups
// together into one card showing the container's own cover/title instead of
// either work's. Deliberately not gated on the container's own catalog
// `format` being 'BUNDLE' — an already-cataloged container can be stuck
// with a stale format from before that value existed (persistToCatalog
// preserves an existing format rather than recomputing it), so the
// relation itself is the only reliable signal here. Needs at least two of
// the container's contents actually present in the library, and the
// container itself already cataloged (for its cover/title) — a bundle with
// only one owned part, or one never added to the local catalog at all,
// isn't worth collapsing into.
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

  const childIdsByContainer = new Map<string, string[]>();
  for (const rel of relations) {
    if (!rel.media_external_id || !CONTAINS_RELATION_TYPES.includes(rel.relation_type)) continue;
    const list = childIdsByContainer.get(rel.media_external_id) ?? [];
    list.push(rel.related_media_external_id);
    childIdsByContainer.set(rel.media_external_id, list);
  }

  const consumed = new Set<number>();
  const bundleGroups: Array<{ item: T; grouped: T[]; bundleMeta: MediaCatalogEntry }> = [];

  for (const [containerId, childIds] of childIdsByContainer) {
    const catalogEntry = catalogMap.get(containerId);
    if (!catalogEntry) continue;

    // Counted by matched *children*, not by distinct root-group indices —
    // a saga (SEQUEL/PREQUEL) pass earlier can already have fused two
    // contained works into a single root group (one "item" + the other in
    // its own "grouped"), which would otherwise look like only one match.
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

// Sequel/prequel relations are saved for games too (IGDB), not just
// anime/manga/lnovel (AniList) — Silent Hill, Metal Gear Solid, Final
// Fantasy VII etc. all have real SEQUEL/PREQUEL rows in media_relations,
// confirmed directly against the DB.
const SAGA_GROUPABLE_TYPES = new Set(['anime', 'manga', 'lnovel', 'game', 'vnovel']);

// Third pass: merges standalone (non-edition, non-bundle) root-groups that
// belong to the very same saga — via the WHOLE catalog's PREQUEL/SEQUEL
// graph, not just relations between two entries the user actually owns.
// That distinction matters: owning 1, 2, 3 and 5 of a saga but not 4 used
// to only group 1-3 together (the 3→4 and 4→5 edges each need *both* ends
// owned to link two owned entries), leaving 5 stranded on its own even
// though it's clearly the same saga. Walking the full graph (every 1-2,
// 2-3, 3-4, 4-5 edge, whether or not "4" itself is in the library) finds
// the one connected saga component 1-2-3-4-5 belongs to regardless of
// gaps, then folds every owned member found in it into one card — same
// aggregate rating/date-range treatment as a bundle, plus the saga's own
// assigned name (PrEditorModal's "Saga Name" field, via sagaNames) in place
// of showing the earliest work's own title, if one was ever set.
// Deliberately only touches groups groupEditions/groupBundles left as bare
// singletons (no bundleMeta, nothing already grouped) — an edition-linked
// or bundle card keeps its own distinct look untouched.
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
    // See groupEditions' old comment (moved here): SECUELA/PRECUELA are the
    // pre-fix, Spanish-label rows some libraries still have on disk.
    // ALTERNATIVE is included too — PrEditorModal's saga editor (see
    // classifySagaChain) writes it between two entries placed in the same
    // "Concept Group" (e.g. a remake alongside its original), which is a
    // saga step exactly like SEQUEL/PREQUEL, just without an order between
    // them — without this, a remake placed this way ends up joined to its
    // original by the separate edition/parent_id mechanism but never folds
    // into the rest of the saga's SEQUEL/PREQUEL cluster.
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

  // A group that groupEditions already fused (e.g. Silent Hill 2 + its
  // remake, joined by the edition/parent_id mechanism) still belongs in the
  // bigger saga cluster if EITHER of its members touches the saga graph —
  // checking only bare singletons here used to leave an edition-linked
  // group stranded next to, instead of merged into, the rest of its own
  // saga (Silent Hill 1/3 on one card, Silent Hill 2 + remake on another,
  // never joined). Only bundles (a genuinely different concept — a
  // container, not a saga step) are excluded.
  const byComponent = new Map<string, number[]>();
  groups.forEach((g, i) => {
    if (g.bundleMeta) return;
    const memberIds = [g.item.external_id, ...g.grouped.map(m => m.external_id)];
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

    // Earliest release first — the group still sits over its first work,
    // same as before.
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
