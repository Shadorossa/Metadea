// Pure grouping logic for the library grid, split out of LibrarySection.tsx.
// Three passes, each building on the previous one's output:
//   groupEditions   -> collapses remakes/remasters/ports under one slot
//   groupBundles    -> collapses a container's owned parts into one card
//   refineSagaGroups -> merges standalone groups belonging to the same saga
import type { MediaCatalogEntry, DbMediaRelation, LibraryEntry } from '../tauri';
import { compareByReleaseDate, stripSeasonSuffix } from '../media/mapper-utils';
import {
  CONTAINS_RELATION_TYPES,
  isSequelRelationType,
} from '../media/sagaTypes';
import { parseDelimitedString } from '../shared/string-utils';
import { createUnionFind } from '../shared/union-find';
import { buildDirectSagaGraph } from './saga-graph';
import { isInProgressStatus, SEASON_STATUS_PRIORITY } from '../constants/media';
import { reconstructSagaOrder } from '../media/sagaGrouping';

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
      const linkedIds = parseDelimitedString(item.selected_version);
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

// editionId -> the base work it's a remake/remaster/expanded edition of,
// chain-flattened (Rebirth -> Remake -> Original collapses straight to
// Original) — and the reverse lookup, original -> every edition of it.
// Shared by groupBundles (a remaster of a bundle's own child joins that
// bundle visually, even with no CONTAINS relation of its own) and
// refineSagaGroups (a remaster with no saga edge of its own borrows its
// original's saga identity).
const EDITION_SOURCE_RELATION_TYPES = new Set(['REMAKE', 'REMASTER', 'EXPANDED_GAME']);

// Exported so stats-calculators.ts's groupSagaChains can redirect a saga-
// less remaster/remake onto its original's saga identity too — same rule
// the library grid's refineSagaGroups uses (see sagaIdentityOf below) — so
// "how many works" doesn't disagree with the grid about what counts as the
// same IP depending on which of the two independently re-derived it.
export function buildEditionMaps(relations: DbMediaRelation[]): { ultimateOriginalOf: Map<string, string>; familyOf: Map<string, string[]> } {
  const originalOf = new Map<string, string>();
  for (const rel of relations) {
    if (!rel.media_external_id) continue;
    if (!EDITION_SOURCE_RELATION_TYPES.has(rel.relation_type)) continue;
    originalOf.set(rel.related_media_external_id, rel.media_external_id);
  }
  const resolve = (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    while (originalOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = originalOf.get(cur)!;
    }
    return cur;
  };
  const ultimateOriginalOf = new Map<string, string>();
  for (const id of originalOf.keys()) ultimateOriginalOf.set(id, resolve(id));

  const familyOf = new Map<string, string[]>();
  for (const [editionId, origId] of ultimateOriginalOf) {
    const list = familyOf.get(origId) ?? [];
    list.push(editionId);
    familyOf.set(origId, list);
  }
  return { ultimateOriginalOf, familyOf };
}

// A remake/remaster only borrows its original's saga identity when no
// edition in its own family (the remake/remaster versions themselves, not
// the original) has a saga relation of its own — e.g. Umineko's remake
// versions have their own separate PREQUEL/SEQUEL chain curated
// independently of the visual novel originals', so those keep their own
// identity instead of redirecting. Returns undefined when there's nothing to
// redirect to (not an edition, or its family already has its own saga
// elsewhere and this specific edition still has no direct edge of its own —
// it just stays ungrouped). Exported (alongside buildEditionMaps) so
// stats-calculators.ts's groupSagaChains applies the exact same "what
// counts as the same IP" rule the grid does, instead of a second,
// independently-drifting copy of it.
export function sagaIdentityOf(
  id: string,
  directSagaIds: Set<string>,
  ultimateOriginalOfMap: Map<string, string>,
  familyOf: Map<string, string[]>,
): string | undefined {
  if (directSagaIds.has(id)) return id;
  if (!ultimateOriginalOfMap.has(id)) return undefined;
  const original = ultimateOriginalOfMap.get(id)!;
  const familyHasOwnSaga = (familyOf.get(original) ?? []).some(sib => directSagaIds.has(sib));
  return familyHasOwnSaga ? undefined : original;
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

  // A remaster/remake of a bundle child is folded into that same bundle
  // here too, purely for this visual grouping — it never gets a CONTAINS
  // relation of its own in the catalog JSONs, but it's still "the same
  // episode" as far as the grid card is concerned. This only widens what
  // groupBundles itself treats as a match; it doesn't touch containerOf (so
  // nothing outside this function ever sees these ids as bundle members —
  // e.g. Local's own pending/in-progress lists stay exactly as they were).
  const { familyOf } = buildEditionMaps(relations);
  const childIdsByContainer = new Map<string, string[]>();
  for (const [childId, containerId] of containerOf) {
    const list = childIdsByContainer.get(containerId) ?? [];
    list.push(childId);
    for (const editionId of familyOf.get(childId) ?? []) {
      list.push(editionId);
    }
    childIdsByContainer.set(containerId, list);
  }

  const consumed = new Set<number>();
  const bundleGroups: Array<{ item: T; grouped: T[]; bundleMeta: MediaCatalogEntry }> = [];

  for (const [containerId, childIds] of childIdsByContainer) {
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

    // The container itself can ALSO be tracked as its own separate library
    // entry — e.g. "Final Fantasy VII Remake Intergrade" logged directly,
    // on top of its two actual contents ("Remake" and "Episode
    // Intermission") each logged on their own — which used to render as
    // TWO cards: this aggregate (built from the matched children below)
    // AND that entry's own untouched standalone card, both showing the
    // same title. Folding it in here as the representative (so this card's
    // underlying entry is the container's own real tracking, not an
    // arbitrary child's) and consuming its index too removes the duplicate
    // — it doesn't join `merged` itself (that's the "+N" flyout's contents,
    // and the bundle isn't one of its own contents).
    const containerIdx = rootIndexOf.get(containerId);
    const containerOwnGroup = containerIdx !== undefined && !consumed.has(containerIdx) ? groups[containerIdx] : undefined;

    let merged: T[] = [];
    let representative: T | null = containerOwnGroup?.item ?? null;
    for (const idx of matchedRootIndices) {
      const g = groups[idx];
      if (!representative) representative = g.item;
      merged.push(g.item, ...g.grouped);
      consumed.add(idx);
    }
    if (containerOwnGroup) consumed.add(containerIdx!);
    // Earliest started_at first — same reasoning as groupEditions: `groups`
    // arrives in the page's own "ordenar por" order, unrelated to the
    // sequence the user actually went through these in.
    merged = merged.sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));

    let catalogEntry = catalogMap.get(containerId);
    if (!catalogEntry && representative) {
      // Bundle container doesn't have a catalog entry yet — create a synthetic one
      // from the first child's metadata plus the container ID. This allows bundles
      // to display even before visiting the media page.
      const firstChildMeta = catalogMap.get((representative as any).external_id);
      if (firstChildMeta) {
        catalogEntry = {
          ...firstChildMeta,
          external_id: containerId,
          title_main: `${containerId}`,
          parent_id: undefined,
        };
      }
    }

    // Only add to bundleGroups if we have a catalog entry AND merged items
    if (catalogEntry && merged.length > 0) {
      bundleGroups.push({ item: representative!, grouped: merged, bundleMeta: catalogEntry });
    }
  }

  const remaining = groups.filter((_, i) => !consumed.has(i));
  return [...remaining, ...bundleGroups];
}

// Games (IGDB) carry real SEQUEL/PREQUEL rows too, not just AniList types —
// and so can movies/series (TMDB), curated manually since TMDB itself has
// no equivalent field this app maps automatically (unlike AniList/IGDB).
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
  const { graph: sagaGraph, directIds: directSagaIds } = buildDirectSagaGraph(relations, catalogMap);

  // originalOf[editionId] = the base work it's a remake/remaster/expanded
  // edition of (chain-flattened, same rootOf technique groupEditions uses
  // for selected_version chains) — a catalog-wide fact, not scoped to what's
  // owned. Shared with groupBundles above (see buildEditionMaps).
  const { ultimateOriginalOf: ultimateOriginalOfMap, familyOf } = buildEditionMaps(relations);
  const sagaIdentityOfHere = (id: string): string | undefined => sagaIdentityOf(id, directSagaIds, ultimateOriginalOfMap, familyOf);

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
      const slot = sagaIdentityOfHere(id);
      if (slot && sagaGraph.has(slot)) {
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
    const comp = sagaGraph.find(slot);
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
      if (sagaGraph.has(id)) completedComponents.add(sagaGraph.find(id));
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
        const sortId = member.external_id !== slot && sagaIdentityOfHere(member.external_id) === slot
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

// "Unificar temporadas" (Settings > Preferencias) — a separate, anime-only
// pass, not a variant of refineSagaGroups above. That one runs PER STATUS
// SECTION, after the library's already been split into Viendo/Completado/
// Planeando/... buckets — fine for editions (a remaster usually shares its
// original's status), but wrong for seasons: season 1 finished and season 3
// still airing/unwatched is the normal case, and the two would never even
// reach the same call to refineSagaGroups since they're filtered into
// different sections before it runs. This runs once on the WHOLE owned list
// before that split happens, so a chain spanning several statuses still
// becomes exactly one card, placed by its latest-started in-progress member
// (so a currently watched, airing cour determines the unified card's section).
// SEASON_STATUS_PRIORITY now lives in lib/constants/media.ts, shared with
// MediaEditorModal.tsx's "general" tab (see its own doc comment there).

export interface UnifiedSeasonGroup<T> {
  item: T;             // representative season - the card's cover and aggregated log source
  grouped: T[];         // every other season
  titleOverride?: string;
  /** Optional catalog container opened by the card. Event leagues keep their
   *  individual season logs, but their unified card opens the competition's
   *  own page so its season list is available. */
  mediaExternalId?: string;
  // The member used for status and progress. Anime chains use the latest-
  // started active season; event leagues use the season selected as the card
  // representative. Otherwise the normal status priority applies.
  statusSourceItem: T;
}

/** Selects the same active season for a unified card wherever it is needed. */
export function latestInProgressMember<T extends { status: string | null; started_at?: string | null }>(members: T[]): T | null {
  const activeMembers = [...members]
    .filter(member => isInProgressStatus(member.status))
    .sort((a, b) => (a.started_at ?? '').localeCompare(b.started_at ?? ''));
  return activeMembers[activeMembers.length - 1] ?? null;
}

export function unifyAnimeSeasons<T extends { external_id: string; status: string | null; started_at?: string | null }>(
  ownedItems: T[],
  catalogMap: Map<string, MediaCatalogEntry>,
  relations: DbMediaRelation[],
  sagaNames: Record<string, string>,
): { consumedIds: Set<string>; groups: Array<UnifiedSeasonGroup<T>> } {
  const sagaGraph = createUnionFind<string>();

  // Anime-only on both sides — deliberately narrower than refineSagaGroups'
  // own SAGA_GROUPABLE_TYPES (games/movies/series too), since those already
  // have their own, separately-toggled grouping story; this setting is
  // specifically about AniList's per-season entries.
  for (const rel of relations) {
    if (!isSequelRelationType(rel.relation_type)) continue;
    if (!rel.media_external_id) continue;
    const a = rel.media_external_id, b = rel.related_media_external_id;
    if (catalogMap.get(a)?.type !== 'anime' || catalogMap.get(b)?.type !== 'anime') continue;
    sagaGraph.union(a, b);
  }

  const byComponent = new Map<string, T[]>();
  for (const item of ownedItems) {
    if (catalogMap.get(item.external_id)?.type !== 'anime') continue;
    if (!sagaGraph.has(item.external_id)) continue; // not part of any chain
    const comp = sagaGraph.find(item.external_id);
    const list = byComponent.get(comp) ?? [];
    list.push(item);
    byComponent.set(comp, list);
  }

  const consumedIds = new Set<string>();
  const groups: Array<UnifiedSeasonGroup<T>> = [];
  for (const members of byComponent.values()) {
    if (members.length < 2) continue; // nothing to merge — leave the lone owned season as-is

    // Earliest release first as the tie-break, but corrected against the
    // real PREQUEL/SEQUEL chain (reconstructSagaOrder) — plain release-date
    // order alone gets it backwards whenever two seasons didn't release in
    // story order (a "Semi-Final"/"Final" movie pair, a delayed re-release,
    // ...), same issue sagaData.ts's own Temporadas-tab ordering already
    // guards against. The card sits over its first work, and "primera y más
    // básica" is what a click opens.
    const memberIds = members.map(m => m.external_id);
    const dateOrderedIds = [...memberIds].sort((a, b) =>
      compareByReleaseDate(catalogMap.get(a) ?? {}, catalogMap.get(b) ?? {})
    );
    const relsByIndex = dateOrderedIds.map(id => relations.filter(r => r.media_external_id === id));
    const orderedIds = reconstructSagaOrder(dateOrderedIds, relsByIndex);
    const byExternalId = new Map(members.map(m => [m.external_id, m]));
    const sorted = orderedIds.map(id => byExternalId.get(id)!);
    const [rep, ...rest] = sorted;

    let statusSourceItem = latestInProgressMember(sorted);
    if (!statusSourceItem) {
      statusSourceItem = sorted[0];
      let bestPriority = SEASON_STATUS_PRIORITY[statusSourceItem.status ?? ''] ?? 5;
      for (const m of sorted) {
        const priority = SEASON_STATUS_PRIORITY[m.status ?? ''] ?? 5;
        if (priority < bestPriority) { bestPriority = priority; statusSourceItem = m; }
      }
    }

    const rawSagaName = sorted.map(m => sagaNames[m.external_id]).find(Boolean);
    const repTitle = catalogMap.get(rep.external_id)?.title_main;
    const cleanRepTitle = repTitle ? stripSeasonSuffix(repTitle) : undefined;
    const isSagaNameFromMember = rawSagaName && sorted.some(m => catalogMap.get(m.external_id)?.title_main === rawSagaName);
    const titleOverride = (rawSagaName && !isSagaNameFromMember) ? rawSagaName : cleanRepTitle;

    for (const m of sorted) consumedIds.add(m.external_id);
    groups.push({ item: rep, grouped: rest, titleOverride, statusSourceItem });
  }

  return { consumedIds, groups };
}

/** API-Sports event-season entries have a stable sport/league/season id.
 *  When unified seasons are enabled, present owned seasons as one competition
 *  card per league, even if the user has only added one season. The individual
 *  user-list rows remain untouched. The representative is the active season
 *  when one is in progress, otherwise the latest season. */
export function unifyEventSeasons<T extends { external_id: string; status: string | null; started_at?: string | null }>(
  ownedItems: T[],
  catalogMap: Map<string, MediaCatalogEntry>,
): { consumedIds: Set<string>; groups: Array<UnifiedSeasonGroup<T>> } {
  const byLeague = new Map<string, T[]>();
  for (const item of ownedItems) {
    if (catalogMap.get(item.external_id)?.type !== 'event') continue;
    const match = /^event:apisports:(football|basketball):(\d+):/.exec(item.external_id);
    if (!match) continue;
    const groupKey = `${match[1]}:${match[2]}`;
    const leagueItems = byLeague.get(groupKey) ?? [];
    leagueItems.push(item);
    byLeague.set(groupKey, leagueItems);
  }

  const consumedIds = new Set<string>();
  const groups: Array<UnifiedSeasonGroup<T>> = [];
  for (const [leagueKey, members] of byLeague) {
    if (members.length === 0) continue;
    const sorted = [...members].sort((a, b) =>
      compareByReleaseDate(catalogMap.get(a.external_id) ?? {}, catalogMap.get(b.external_id) ?? {})
    );
    let statusSourceItem = latestInProgressMember(sorted);
    if (!statusSourceItem) {
      // The input is release-sorted oldest-to-newest, so ties retain the
      // latest season while a more relevant list status can still win.
      statusSourceItem = sorted[sorted.length - 1];
      let bestPriority = SEASON_STATUS_PRIORITY[statusSourceItem.status ?? ''] ?? 5;
      for (const member of sorted) {
        const priority = SEASON_STATUS_PRIORITY[member.status ?? ''] ?? 5;
        if (priority < bestPriority) { bestPriority = priority; statusSourceItem = member; }
      }
    }
    const title = catalogMap.get(statusSourceItem.external_id)?.title_main?.trim();
    const lastSeparator = title?.lastIndexOf(' - ') ?? -1;
    const titleOverride = lastSeparator > 0 ? title!.slice(0, lastSeparator).trim() : undefined;
    const grouped = sorted.filter(member => member.external_id !== statusSourceItem!.external_id);
    for (const member of sorted) consumedIds.add(member.external_id);
    groups.push({
      item: statusSourceItem,
      grouped,
      titleOverride,
      statusSourceItem,
      mediaExternalId: `event:apisports:${leagueKey}`,
    });
  }
  return { consumedIds, groups };
}
