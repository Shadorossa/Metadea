import { useEffect, useMemo, useState } from 'react';
import { getAllLibraryEntries, getAllCatalogEntries, getAllMediaRelations, getCatalogEntry, getSagaNames } from '../../lib/tauri';
import type { MediaCatalogEntry, DbMediaRelation, LibraryEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { getActiveRatingSystem, syncActiveRatingSystem, formatRatingHtml } from '../../lib/media/rating-utils';
import { typeIconMap, CALENDAR_ICON, SORT_ICON_SCORE, SORT_ICON_DATE, SORT_ICON_DURATION, GROUP_EDITIONS_ICON } from '../../lib/shared/icon-strings';
import { TYPE_LABELS, isInProgressStatus } from '../../lib/constants/media';
import { getItemMinutes } from '../../lib/profile/stats-calculators';
import { compareByReleaseDate } from '../../lib/media/mapper-utils';
import { needsResync, isCaughtUpOnReleasing } from '../../lib/media/media-status';
import { fetchMediaData } from '../../lib/media/mediaService';
import { CONTAINS_RELATION_TYPES } from '../../lib/media/sagaTypes';
import { formatDateNumeric } from '../../lib/shared/formatDate';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type SortBy = 'rating' | 'date' | 'duration';

const TYPE_ICON = typeIconMap(16);

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return formatDateNumeric(d);
}

// Matches a single leading emoji (plus an optional variation selector) at the
// very start of a tag string — e.g. "🎨Arte" → emoji "🎨", name "Arte". Tags
// are free text (see MediaEditorModal's tag input), so only tags the user
// actually prefixed with an emoji get a bookmark; plain-text tags are skipped.
const TAG_EMOJI_RE = /^(\p{Extended_Pictographic}️?)(.*)$/u;

function tagBadges(tags: string[] | null | undefined): { emoji: string; label: string }[] {
  if (!tags || tags.length === 0) return [];
  return tags
    .map(tag => {
      const match = TAG_EMOJI_RE.exec(tag.trim());
      if (!match) return null;
      const [, emoji, name] = match;
      return { emoji, label: name.trim() || tag.trim() };
    })
    .filter((t): t is { emoji: string; label: string } => t !== null);
}

// Sequel/prequel relations are saved for games too (IGDB), not just
// anime/manga/lnovel (AniList) — Silent Hill, Metal Gear Solid, Final
// Fantasy VII etc. all have real SEQUEL/PREQUEL rows in media_relations,
// confirmed directly against the DB.
const SAGA_GROUPABLE_TYPES = new Set(['anime', 'manga', 'lnovel', 'game', 'vnovel']);

// Groups library entries that are editions of one another (remakes,
// remasters, ports, ...) under a single "slot" so they don't each claim a
// spot in the grid. Gated entirely behind "Agrupar por ediciones" — sequel/
// prequel (saga) grouping used to also live here, but now runs separately
// in refineSagaGroups (see its own doc for why: an edition link only ever
// connects two owned entries directly, which is fine for editions, but a
// saga needs to bridge across works the user doesn't own at all).
function groupEditions<T extends { external_id: string; selected_version: string | null; type: string }>(
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
function groupBundles<T extends { external_id: string }>(
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
function refineSagaGroups<T extends { external_id: string }>(
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

const STATUS_KEYS = ['', 'planning', 'in_progress', 'completed', 'paused', 'dropped'] as const;

// Averages the ratings of every work a bundle groups together, ignoring
// unrated ones — e.g. Adventures rated 8, Resolve unrated → the bundle
// shows 8, not a skewed average against a missing score.
function averageRating(entries: LibraryEntry[]): number | null {
  const rated = entries.map(e => e.rating).filter((r): r is number => r != null);
  if (rated.length === 0) return null;
  return rated.reduce((a, b) => a + b, 0) / rated.length;
}

function LibraryCard({ item, grouped, bundleMeta, titleOverride, aggregateStats, catalogMap, p }: {
  item: LibraryEntry;
  grouped: LibraryEntry[];
  bundleMeta?: MediaCatalogEntry;
  /** Saga's own assigned name (PrEditorModal's "Saga Name" field), shown
   *  instead of the earliest work's own title when a saga-chain merge found
   *  one — the bundle's own title_main plays the same role for bundles. */
  titleOverride?: string;
  /** True for a saga-chain merge (see refineSagaGroups) — same aggregate
   *  rating/date-range treatment as a bundle, just without swapping the
   *  cover (a saga still sits over its first work's own cover). */
  aggregateStats?: boolean;
  catalogMap: Map<string, MediaCatalogEntry>;
  p: ReturnType<typeof getT>['profile'];
}) {
  const meta = catalogMap.get(item.external_id);
  const isAggregate = !!bundleMeta || !!aggregateStats;
  const title = bundleMeta?.title_main ?? titleOverride ?? meta?.title_main ?? item.external_id;
  const cover = bundleMeta?.cover_url ?? meta?.cover_url ?? '';
  const typeIc = TYPE_ICON[item.type] ?? TYPE_ICON['book'];
  const mediaUrl = `/media?id=${encodeURIComponent(bundleMeta?.external_id ?? item.external_id)}`;
  const badges = tagBadges(item.tags);

  // Chronological, earliest first — so a saga's flyout reads left to right
  // in release order (SH1, SH2, SH3, ...) instead of whatever order the
  // section's own sort (rating/date-finished/duration) happened to leave
  // them in.
  const orderedGrouped = [...grouped].sort((a, b) =>
    compareByReleaseDate(catalogMap.get(a.external_id) ?? {}, catalogMap.get(b.external_id) ?? {})
  );
  const groupedTitles = orderedGrouped.map(g => catalogMap.get(g.external_id)?.title_main ?? g.external_id);

  // A bundle or saga-chain card merges every member's own rating/dates
  // instead of showing just the root's own — there's no single "item" that
  // represents the whole group's progress. groupBundles' own `grouped`
  // already includes the representative item itself (it's built by
  // concatenating every matched sub-group's own item+grouped, one of which
  // *is* the representative's), while refineSagaGroups' `grouped` is just
  // "the others" — so only the saga case needs `item` added back in here.
  const aggregateMembers = bundleMeta ? orderedGrouped : [item, ...orderedGrouped];
  const ratingHtml = isAggregate
    ? formatRatingHtml(averageRating(aggregateMembers), getActiveRatingSystem(), 'library-card-rating')
    : formatRatingHtml(item.rating, getActiveRatingSystem(), 'library-card-rating');
  const dateStr = isAggregate
    ? (() => {
        const sorted = [...aggregateMembers].sort((a, b) =>
          compareByReleaseDate(catalogMap.get(a.external_id) ?? {}, catalogMap.get(b.external_id) ?? {})
        );
        return [fmtDate(sorted[0]?.started_at), fmtDate(sorted[sorted.length - 1]?.finished_at)].filter(Boolean).join(' → ');
      })()
    : [fmtDate(item.started_at), fmtDate(item.finished_at)].filter(Boolean).join(' → ');

  const openEditor = () => {
    if (bundleMeta) {
      // The bundle itself has no library log of its own (it's not something
      // you "play" — its contents are), so there's nothing to open the
      // editor for; go to its media page instead, same as clicking the cover.
      window.location.href = mediaUrl;
      return;
    }
    window.dispatchEvent(new CustomEvent('open-profile-editor', {
      detail: { externalId: item.external_id, libraryEntry: item, catalogEntry: meta },
    }));
  };

  return (
    <div className={`library-card-cell${grouped.length > 0 ? ' library-card-cell--stacked' : ''}`}>
      {/* .library-card-stack-extra is a *sibling* of .library-card, both
          wrapped in .library-card-cell, instead of a child of the card
          itself. The card needs overflow:hidden permanently (it clips its
          own blurred cover background) — toggling that off on hover so the
          flyout could escape also un-clipped the blur, making the card
          visibly wider than its column on every hover, grouped or not. The
          wrapper carries overflow:visible instead, and has no painted
          content of its own to worry about clipping. */}
      <div className="library-card" data-id={item.external_id} onClick={openEditor}>
        {cover && <div className="library-card-bg"><img className="library-card-bg-img" src={cover} alt="" /></div>}
        {grouped.length > 0 && (
          <span className="library-card-group-badge" title={`${p.library_group_editions_hint}: ${groupedTitles.join(', ')}`}>
            +{grouped.length}
          </span>
        )}
        {badges.length > 0 && (
          <div className="library-card-tag-badges">
            {badges.map((b, i) => <span className="library-card-tag-badge" title={b.label} key={i}>{b.emoji}</span>)}
          </div>
        )}
        <a className="library-card-thumb" href={mediaUrl} onClick={e => e.stopPropagation()}>
          {cover
            ? <img src={cover} alt={title} loading="lazy" />
            : <div className="library-card-no-cover"><span>{title.slice(0, 2).toUpperCase()}</span></div>}
        </a>
        <div className="library-card-info">
          <span className="library-card-title">{title}</span>
          <div className="library-card-bottom-group">
            <span dangerouslySetInnerHTML={{ __html: ratingHtml }} />
            <div className="library-card-footer">
              {dateStr && <span className="library-card-date" dangerouslySetInnerHTML={{ __html: CALENDAR_ICON + dateStr }} />}
              <span className="library-card-type" dangerouslySetInnerHTML={{ __html: typeIc }} />
            </div>
          </div>
        </div>
      </div>
      {grouped.length > 0 && (
        // Hidden until hover (see .library-card--stacked:hover in
        // profile.css) — a peek at exactly what's collapsed under the "+N"
        // badge, sliding out to the right instead of making the user guess
        // from the badge's tooltip alone.
        <div className="library-card-stack-extra">
          {orderedGrouped.map(g => {
            const gMeta = catalogMap.get(g.external_id);
            const gTitle = gMeta?.title_main ?? g.external_id;
            const gCover = gMeta?.cover_url ?? '';
            return (
              <a
                key={g.external_id}
                className="library-card-stack-extra-item"
                href={`/media?id=${encodeURIComponent(g.external_id)}`}
                title={gTitle}
                onClick={e => e.stopPropagation()}
              >
                {gCover
                  ? <img src={gCover} alt={gTitle} loading="lazy" />
                  : <div className="library-card-no-cover"><span>{gTitle.slice(0, 2).toUpperCase()}</span></div>}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

// media_catalog.format values this filter cares about (see i18n's
// media.formats for their display labels) — a fixed subset, not every possible format, so an
// item whose format is something else entirely (or unset, for non-game
// types) is left alone by this filter rather than hidden by it. 'GAME' (the
// base entry, no edition) is surfaced to the user as "Main".
const EDITION_FILTER_OPTIONS = [
  { key: 'GAME', label: 'Main' },
  { key: 'REMAKE', label: 'Remake' },
  { key: 'EXPANDED_GAME', label: 'Expanded Game' },
  { key: 'REMASTER', label: 'Remaster' },
  { key: 'UPDATE', label: 'Update' },
  { key: 'SEASON', label: 'Season' },
  { key: 'ISSUE', label: 'Issue' },
] as const;
const EDITION_FILTER_KEYS = new Set(EDITION_FILTER_OPTIONS.map(o => o.key));
const DEFAULT_EDITION_FILTERS = ['GAME', 'REMAKE', 'EXPANDED_GAME', 'REMASTER'];

export function LibrarySection() {
  const p = getT().profile;
  const STATUS_LIST = useMemo(() => [
    { key: '', label: p.section_all },
    { key: 'planning', label: p.status_planning },
    { key: 'in_progress', label: p.section_in_progress },
    { key: 'completed', label: p.status_completed },
    { key: 'paused', label: p.status_paused },
    { key: 'dropped', label: p.status_dropped },
  ], [p]);

  const [items, setItems] = useState<Items | null>(null);
  const [catalogMap, setCatalogMap] = useState<Map<string, MediaCatalogEntry>>(new Map());
  const [sagaRelations, setSagaRelations] = useState<DbMediaRelation[]>([]);
  const [sagaNames, setSagaNames] = useState<Record<string, string>>({});

  const [nameFilter, setNameFilter] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedEditionFormats, setSelectedEditionFormats] = useState<string[]>(DEFAULT_EDITION_FILTERS);
  const [statusIndex, setStatusIndex] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [groupByEdition, setGroupByEdition] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [rawItems, catalogEntries, relations] = await Promise.all([
        getAllLibraryEntries().catch(() => [] as Items),
        getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
        getAllMediaRelations().catch(() => [] as DbMediaRelation[]),
      ]);
      // Refreshes the localStorage cache read by getActiveRatingSystem()
      // used per-card below — see syncActiveRatingSystem's own doc.
      await syncActiveRatingSystem();
      if (cancelled) return;
      setItems(rawItems);
      setCatalogMap(new Map(catalogEntries.map(e => [e.external_id, e])));
      setSagaRelations(relations);
      getSagaNames(rawItems.map(i => i.external_id)).then(names => { if (!cancelled) setSagaNames(names); }).catch(() => {});

      // Entering your library is the other trigger point (besides visiting
      // the media page itself) for needsResync()'s per-status cadence —
      // catches shows/manga you're actively watching/reading even if you
      // don't click into their page that day. needsResync() itself decides
      // what's actually due: RELEASING every 7 days (any type — anime AND
      // manga/lnovel chapters go through the exact same total_count/status
      // pipeline, see anilist-mapper.ts), other statuses on their own longer
      // cadence, and — the case this also backfills — a catalog row that
      // was never synced at all (last_synced_at missing entirely, e.g. a
      // stub created before this system existed, or one only ever filled in
      // via community-catalog sync) is always immediately due, so its first
      // library visit does a full live re-fetch and finally records
      // last_synced_at/status/total_count for it.
      // Scoped to in-progress entries only (no point re-checking something
      // you haven't started), sequential with a short stagger so a library
      // full of ongoing shows doesn't burst AniList's rate limit, and each
      // result is patched into catalogMap as it lands so "Al día" grouping
      // and episode/chapter counts update live.
      const dueForResync = rawItems.filter(item => {
        if (!isInProgressStatus(item.status)) return false;
        const catalog = catalogEntries.find(e => e.external_id === item.external_id);
        return needsResync(catalog);
      });

      for (const item of dueForResync) {
        if (cancelled) return;
        await fetchMediaData(item.external_id).catch(() => null);
        const fresh = await getCatalogEntry(item.external_id).catch(() => null);
        if (cancelled) return;
        if (fresh) {
          setCatalogMap(prev => new Map(prev).set(fresh.external_id, fresh));
        }
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    };

    load();

    // Fired by ProfileLibraryEditor after a save/delete in the media editor
    // modal — re-fetches in place (setState diffs just the changed card)
    // instead of profile.astro re-mounting this whole component from
    // scratch, which used to unmount/remount the entire grid (every card,
    // every filter control) for a one-field change, flashing the full tab.
    window.addEventListener('refresh-profile-library', load);
    return () => {
      cancelled = true;
      window.removeEventListener('refresh-profile-library', load);
    };
  }, []);

  const sections = useMemo(() => {
    if (!items) return null;

    const nameVal = nameFilter.toLowerCase().trim();
    const statusKey = STATUS_LIST[statusIndex].key;

    const filtered = items.filter(item => {
      const meta = catalogMap.get(item.external_id);
      const title = (meta?.title_main ?? item.external_id).toLowerCase();
      if (nameVal && !title.includes(nameVal)) return false;
      if (selectedTypes.length > 0 && !selectedTypes.includes(item.type)) return false;
      const editionFormat = meta?.format || 'GAME';
      if (EDITION_FILTER_KEYS.has(editionFormat) && !selectedEditionFormats.includes(editionFormat)) return false;
      if (statusKey) {
        if (statusKey === 'in_progress') { if (!isInProgressStatus(item.status)) return false; }
        else if (item.status !== statusKey) return false;
      }
      return true;
    });

    if (filtered.length === 0) return [];

    const sortItems = (itemList: Items) => [...itemList].sort((a, b) => {
      if (sortBy === 'rating') return (b.rating ?? 0) - (a.rating ?? 0);
      if (sortBy === 'duration') return getItemMinutes(b, catalogMap) - getItemMinutes(a, catalogMap);
      const dateA = a.finished_at ? new Date(a.finished_at).getTime() : 0;
      const dateB = b.finished_at ? new Date(b.finished_at).getTime() : 0;
      if (dateA === 0 && dateB !== 0) return 1;
      if (dateB === 0 && dateA !== 0) return -1;
      return dateB - dateA; // newest finished to oldest finished
    });

    // "Al día" is a purely computed regrouping, not a stored status — an
    // in-progress entry moves here when its progress has caught up with
    // everything a still-RELEASING show has aired/published so far (see
    // isCaughtUpOnReleasing), and drops back into "En curso" the moment the
    // weekly resync raises total_count past it again.
    const caughtUp = (i: Items[number]) => isCaughtUpOnReleasing(i.status, i.progress, catalogMap.get(i.external_id));

    const sectionsData = [
      { title: p.section_caught_up, items: sortItems(filtered.filter(i => isInProgressStatus(i.status) && caughtUp(i))) },
      { title: p.section_in_progress, items: sortItems(filtered.filter(i => isInProgressStatus(i.status) && !caughtUp(i))) },
      { title: p.section_completed, items: sortItems(filtered.filter(i => i.status === 'completed')) },
      { title: p.section_planning, items: sortItems(filtered.filter(i => i.status === 'planning')) },
      { title: p.section_paused, items: sortItems(filtered.filter(i => i.status === 'paused')) },
      { title: p.section_dropped, items: sortItems(filtered.filter(i => i.status === 'dropped')) },
    ];

    return sectionsData
      .filter(sec => sec.items.length > 0)
      // Edition, bundle (CONTAINS), and saga-chain (PREQUEL/SEQUEL)
      // grouping are all gated behind "Agrupar por ediciones" now — none of
      // this runs on the plain, ungrouped grid.
      .map(sec => {
        const editionGroups = groupEditions(sec.items, catalogMap, groupByEdition);
        let cards: Array<{ item: Items[number]; grouped: Items[number][]; bundleMeta?: MediaCatalogEntry; titleOverride?: string; aggregateStats?: boolean }> = editionGroups;
        if (groupByEdition) {
          cards = groupBundles(editionGroups, catalogMap, sagaRelations);
          cards = refineSagaGroups(cards, catalogMap, sagaRelations, sagaNames);
        }

        // groupBundles/refineSagaGroups can both append merged cards at the
        // end regardless of date/rating — re-sort by the same criteria as
        // the section itself, using the group's own aggregate (every
        // member's rating/duration, latest finished_at) in place of a
        // single item's fields whenever one applies.
        cards = [...cards].sort((a, b) => {
          const isAggA = !!a.bundleMeta || !!a.aggregateStats;
          const isAggB = !!b.bundleMeta || !!b.aggregateStats;
          const aWorks = isAggA ? (a.bundleMeta ? a.grouped : [a.item, ...a.grouped]) : [a.item];
          const bWorks = isAggB ? (b.bundleMeta ? b.grouped : [b.item, ...b.grouped]) : [b.item];
          if (sortBy === 'rating') return (averageRating(bWorks) ?? 0) - (averageRating(aWorks) ?? 0);
          if (sortBy === 'duration') {
            const sum = (arr: Items[number][]) => arr.reduce((acc, it) => acc + getItemMinutes(it, catalogMap), 0);
            return sum(bWorks) - sum(aWorks);
          }
          const latestFinished = (arr: Items[number][]) => Math.max(0, ...arr.map(it => it.finished_at ? new Date(it.finished_at).getTime() : 0));
          const dateA = latestFinished(aWorks);
          const dateB = latestFinished(bWorks);
          if (dateA === 0 && dateB !== 0) return 1;
          if (dateB === 0 && dateA !== 0) return -1;
          return dateB - dateA;
        });

        return { title: sec.title, cards };
      });
  }, [items, catalogMap, sagaRelations, sagaNames, nameFilter, selectedTypes, selectedEditionFormats, statusIndex, sortBy, groupByEdition, STATUS_LIST, p]);

  if (items === null) return null;

  if (items.length === 0) {
    return (
      <div className="profile-empty">
        <span className="profile-empty-icon">📚</span>
        <p>{p.empty}</p>
        <a href="/search">{p.empty_cta}</a>
      </div>
    );
  }

  return (
    <div className="library-layout entering">
      <aside className="library-filters">
        <p className="library-filters-title">{p.library_filters}</p>

        <div className="library-filter-group">
          <label className="library-filter-label" htmlFor="filter-name">Nombre</label>
          <input
            type="text"
            id="filter-name"
            className="library-filter-input"
            placeholder="Buscar por título..."
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
          />
        </div>

        <div className="library-filter-group">
          <label className="library-filter-label">Tipo de Medio</label>
          <div className="library-type-filters">
            {Object.entries(TYPE_ICON).map(([type, svg]) => (
              <button
                key={type}
                type="button"
                className={`library-type-btn ${selectedTypes.includes(type) ? 'active' : ''}`}
                title={TYPE_LABELS[type] || type}
                onClick={() => setSelectedTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type])}
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ))}
          </div>
        </div>

        <div className="library-filter-group">
          <label className="library-filter-label">Tipo de Edición</label>
          <div className="library-edition-filters">
            {EDITION_FILTER_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                className={`library-edition-btn ${selectedEditionFormats.includes(opt.key) ? 'active' : ''}`}
                onClick={() => setSelectedEditionFormats(prev =>
                  prev.includes(opt.key) ? prev.filter(k => k !== opt.key) : [...prev, opt.key]
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="library-filter-group">
          <label className="library-filter-label">Estado</label>
          <div className="library-status-cycler">
            <button
              type="button"
              className="library-status-arrow"
              onClick={() => setStatusIndex(i => (i - 1 + STATUS_LIST.length) % STATUS_LIST.length)}
            >
              &lt;
            </button>
            <span className="library-status-val">{STATUS_LIST[statusIndex].label}</span>
            <button
              type="button"
              className="library-status-arrow"
              onClick={() => setStatusIndex(i => (i + 1) % STATUS_LIST.length)}
            >
              &gt;
            </button>
          </div>
        </div>

        <div className="library-filter-group">
          <button
            type="button"
            className={`library-toggle-btn ${groupByEdition ? 'active' : ''}`}
            onClick={() => setGroupByEdition(g => !g)}
          >
            <span dangerouslySetInnerHTML={{ __html: GROUP_EDITIONS_ICON }} />
            <span>{p.library_group_editions}</span>
          </button>
        </div>
      </aside>

      <div className="library-content">
        <div className="library-content-header">
          <div className="library-filter-group select-sort">
            <span className="library-sort-label">Ordenar por</span>
            <div className="library-sort-options">
              <button type="button" className={`library-sort-btn ${sortBy === 'rating' ? 'active' : ''}`} title="Calificación" onClick={() => setSortBy('rating')} dangerouslySetInnerHTML={{ __html: SORT_ICON_SCORE }} />
              <button type="button" className={`library-sort-btn ${sortBy === 'date' ? 'active' : ''}`} title="Fecha" onClick={() => setSortBy('date')} dangerouslySetInnerHTML={{ __html: SORT_ICON_DATE }} />
              <button type="button" className={`library-sort-btn ${sortBy === 'duration' ? 'active' : ''}`} title="Duración" onClick={() => setSortBy('duration')} dangerouslySetInnerHTML={{ __html: SORT_ICON_DURATION }} />
            </div>
          </div>
        </div>
        <div className="library-sections-list">
          {sections && sections.length === 0 && (
            <div className="library-empty-filtered">Sin resultados para los filtros aplicados</div>
          )}
          {sections?.map(sec => (
            <div className="library-section" key={sec.title}>
              <h3 className="library-section-title">{sec.title}</h3>
              <div className="library-grid">
                {sec.cards.map(({ item, grouped, bundleMeta, titleOverride, aggregateStats }) => (
                  <LibraryCard
                    item={item}
                    grouped={grouped}
                    bundleMeta={bundleMeta}
                    titleOverride={titleOverride}
                    aggregateStats={aggregateStats}
                    catalogMap={catalogMap}
                    p={p}
                    key={bundleMeta?.external_id ?? item.external_id}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
