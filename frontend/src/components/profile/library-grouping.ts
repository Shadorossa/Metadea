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
export function groupEditions<T extends { external_id: string; selected_version: string | null; type: string; started_at: string | null }>(
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
    // Earliest started_at first — sectionItems arrives in whatever order the
    // page's own "ordenar por" setting picked (rating, date finished,
    // alphabetical, ...), which has nothing to do with the sequence the user
    // actually went through these editions/episodes in, so it can't just be
    // inherited here. started_at (user-set) reflects that intent directly,
    // unlike added_at (just when the row was first created).
    const grouped = sectionItems
      .filter(other => parentOf.get(other.external_id) === item.external_id)
      .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
    out.push({ item, grouped });
  }

  return out;
}

// Second pass: collapses groups a CONTAINS/EPISODE relation ties to one
// container into a single card with the container's cover/title. Goes by
// the relation itself, not the container's `format`, since that can be
// stale; needs 2+ owned contents plus the container itself already cataloged.
export function groupBundles<T extends { external_id: string; started_at: string | null }>(
  groups: Array<{ item: T; grouped: T[] }>,
  catalogMap: Map<string, MediaCatalogEntry>,
  relations: DbMediaRelation[],
  // Every completed work's own id, only passed by non-"Completado" sections
  // (undefined there) — a bundle that already has a completed member
  // shouldn't also form an aggregate card among your dropped/pending/
  // paused/in-progress ones; each stays its own individual entry instead.
  suppressIfCompletedElsewhere?: Set<string>,
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

    // The container itself or any of its children (owned or not — this is
    // a catalog-wide relation fact, not scoped to what's in this section)
    // already completed elsewhere — leave every matched child as its own
    // individual card here instead of also forming this aggregate.
    if (suppressIfCompletedElsewhere && (
      suppressIfCompletedElsewhere.has(containerId) || childIds.some(id => suppressIfCompletedElsewhere.has(id))
    )) continue;

    const matchedRootIndices = new Set([...matchedChildIds].map(id => rootIndexOf.get(id)!));

    let merged: T[] = [];
    let representative: T | null = null;
    for (const idx of matchedRootIndices) {
      const g = groups[idx];
      if (!representative) representative = g.item;
      merged.push(g.item, ...g.grouped);
      consumed.add(idx);
    }
    // Earliest started_at first — same reasoning as groupEditions: `groups`
    // arrives in the page's own "ordenar por" order, unrelated to the
    // sequence the user actually went through these in.
    merged = merged.sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
    bundleGroups.push({ item: representative!, grouped: merged, bundleMeta: catalogEntry });
  }

  const remaining = groups.filter((_, i) => !consumed.has(i));
  return [...remaining, ...bundleGroups];
}

// Games (IGDB) carry real SEQUEL/PREQUEL rows too, not just AniList types —
// and so can movies/series (TMDB), curated manually since TMDB itself has
// no equivalent field this app maps automatically (unlike AniList/IGDB).
const SAGA_GROUPABLE_TYPES = new Set(['anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series']);

// Third pass: merges standalone groups belonging to the same saga, walking
// the WHOLE catalog's PREQUEL/SEQUEL graph (not just relations between owned
// entries) so a gap (owning 1,2,3,5 but not 4) doesn't strand 5 on its own.
// Only touches bare singletons — edition/bundle cards keep their own look.
export function refineSagaGroups<T extends { external_id: string }>(
  groups: Array<{ item: T; grouped: T[]; bundleMeta?: MediaCatalogEntry }>,
  catalogMap: Map<string, MediaCatalogEntry>,
  relations: DbMediaRelation[],
  sagaNames: Record<string, string>,
  // Every completed work's own id, only passed by non-"Completado" sections
  // (undefined there) — a saga that already has a completed member
  // shouldn't also form an aggregate card among your dropped/pending/
  // paused/in-progress ones; each stays its own individual entry instead.
  suppressIfCompletedElsewhere?: Set<string>,
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

  const directSagaIds = new Set<string>();
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
    directSagaIds.add(a);
    directSagaIds.add(b);
  }

  // originalOf[editionId] = the base work it's a remake/remaster/expanded
  // edition of (chain-flattened, same rootOf technique groupEditions uses
  // for selected_version chains) — a catalog-wide fact, not scoped to what's
  // owned.
  const EDITION_SOURCE_RELATION_TYPES = new Set(['REMAKE', 'REMASTER', 'EXPANDED_GAME']);
  const originalOf = new Map<string, string>();
  for (const rel of relations) {
    if (!rel.media_external_id) continue;
    if (!EDITION_SOURCE_RELATION_TYPES.has(rel.relation_type)) continue;
    originalOf.set(rel.related_media_external_id, rel.media_external_id);
  }
  const ultimateOriginalOf = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (originalOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = originalOf.get(cur)!;
    }
    return cur;
  };
  const familyOf = new Map<string, string[]>();
  for (const id of originalOf.keys()) {
    const orig = ultimateOriginalOf(id);
    const list = familyOf.get(orig) ?? [];
    list.push(id);
    familyOf.set(orig, list);
  }

  // A remake/remaster only borrows its original's saga identity when no
  // edition in its own family (the remake/remaster versions themselves, not
  // the original) has a saga relation of its own — e.g. Umineko's remake
  // versions have their own separate PREQUEL/SEQUEL chain curated
  // independently of the visual novel originals', so those keep their own
  // identity instead of redirecting. Returns undefined when there's nothing
  // to redirect to (not an edition, or its family already has its own saga
  // elsewhere and this specific edition still has no direct edge of its
  // own — it just stays ungrouped, same as before this existed).
  const sagaIdentityOf = (id: string): string | undefined => {
    if (directSagaIds.has(id)) return id;
    if (!originalOf.has(id)) return undefined;
    const original = ultimateOriginalOf(id);
    const familyHasOwnSaga = (familyOf.get(original) ?? []).some(sib => directSagaIds.has(sib));
    return familyHasOwnSaga ? undefined : original;
  };

  // A bundle member (either side of EPISODE/PART_OF) never joins a saga
  // cluster, even with "Agrupar por bundle" off (bundleMeta unset then).
  const bundleParticipantIds = new Set<string>();
  for (const rel of relations) {
    if (!rel.media_external_id || !CONTAINS_RELATION_TYPES.includes(rel.relation_type)) continue;
    bundleParticipantIds.add(rel.media_external_id);
    bundleParticipantIds.add(rel.related_media_external_id);
  }

  // Resolve exactly one saga "slot" per owned group — its own id if it (or
  // an edition-fused sibling) has a direct saga edge, else whichever
  // original a remake/remaster redirects to. Two owned groups landing on
  // the same slot (e.g. TLOU2 original + TLOU2 remaster both owned) are the
  // same work for saga purposes, not two — resolved below.
  const slotOf = new Map<number, string>();
  groups.forEach((g, i) => {
    if (g.bundleMeta) return;
    const memberIds = [g.item.external_id, ...g.grouped.map(m => m.external_id)];
    if (memberIds.some(id => bundleParticipantIds.has(id))) return;
    for (const id of memberIds) {
      const slot = sagaIdentityOf(id);
      if (slot && parent.has(slot)) {
        slotOf.set(i, slot);
        return;
      }
    }
  });

  // Collapse same-slot duplicates. Direct ownership of the slot's own real
  // id wins as the visible representative over a remake/remaster
  // redirecting into it (arbitrary first-wins if somehow neither is direct,
  // e.g. two different remasters of the same original both owned); the
  // loser is consumed — removed from the grid as its own stray card,
  // without ever surfacing as a visible saga member (title, "+N" count) —
  // just silently folded in so it doesn't clutter the library. Contrast
  // with a family whose original isn't owned at all: there, the remake/
  // remaster IS the slot's sole representative and stays fully visible.
  const representativeForSlot = new Map<string, number>();
  const consumed = new Set<number>();
  for (const [i, slot] of slotOf) {
    const existing = representativeForSlot.get(slot);
    if (existing === undefined) {
      representativeForSlot.set(slot, i);
      continue;
    }
    const isDirect = (idx: number) => groups[idx].item.external_id === slot || groups[idx].grouped.some(m => m.external_id === slot);
    if (isDirect(i) && !isDirect(existing)) {
      consumed.add(existing);
      representativeForSlot.set(slot, i);
    } else {
      consumed.add(i);
    }
  }

  const idxToSlot = new Map<number, string>();
  const byComponent = new Map<string, number[]>();
  for (const [slot, i] of representativeForSlot) {
    idxToSlot.set(i, slot);
    const comp = find(slot);
    const list = byComponent.get(comp) ?? [];
    list.push(i);
    byComponent.set(comp, list);
  }

  // Which saga components already have a completed member — catalog-wide
  // (via the same union-find graph above), not scoped to what's owned in
  // this particular section.
  const completedComponents = new Set<string>();
  if (suppressIfCompletedElsewhere) {
    for (const id of suppressIfCompletedElsewhere) {
      if (parent.has(id)) completedComponents.add(find(id));
    }
  }

  const sagaGroups: Array<{ item: T; grouped: T[]; titleOverride?: string; aggregateStats: boolean }> = [];

  for (const [comp, indices] of byComponent) {
    if (indices.length < 2) continue; // nothing to merge — leave the lone entry exactly as-is
    if (completedComponents.has(comp)) continue; // has a completed member elsewhere — stays split, not merged here

    // Sorted by the ORIGINAL's release date whenever a member is standing in
    // for one (a remake/remaster with no saga of its own, redirected onto
    // its original's slot) — its own real release date is almost always
    // much later than where it actually belongs in the saga (e.g. RE1
    // Remake, 2002, standing in for RE1, 1996, ahead of RE2, 1998 — sorting
    // by the remake's own date would wrongly put RE2 first).
    const allMembers: Array<{ member: T; sortId: string }> = [];
    for (const idx of indices) {
      const g = groups[idx];
      const slot = idxToSlot.get(idx)!;
      for (const member of [g.item, ...g.grouped]) {
        const sortId = member.external_id !== slot && sagaIdentityOf(member.external_id) === slot
          ? slot
          : member.external_id;
        allMembers.push({ member, sortId });
      }
      consumed.add(idx);
    }

    // Earliest release first — the group sits over its first work.
    const sorted = [...allMembers].sort((a, b) =>
      compareByReleaseDate(catalogMap.get(a.sortId) ?? {}, catalogMap.get(b.sortId) ?? {})
    ).map(({ member }) => member);
    const [rep, ...rest] = sorted;
    const sagaName = sorted.map(m => sagaNames[m.external_id]).find(Boolean);
    sagaGroups.push({ item: rep, grouped: rest, titleOverride: sagaName, aggregateStats: true });
  }

  const remaining = groups.filter((_, i) => !consumed.has(i));
  return [...remaining, ...sagaGroups];
}

// Averages the ratings of every work a bundle groups together, ignoring
// unrated ones — e.g. Adventures rated 8, Resolve unrated → the bundle
// shows 8, not a skewed average against a missing score.
export function averageRating(entries: LibraryEntry[], slot: 'rating' | 'rating_2' = 'rating'): number | null {
  const rated = entries.map(e => slot === 'rating_2' ? e.rating_2 : e.rating).filter((r): r is number => r != null);
  if (rated.length === 0) return null;
  return rated.reduce((a, b) => a + b, 0) / rated.length;
}
