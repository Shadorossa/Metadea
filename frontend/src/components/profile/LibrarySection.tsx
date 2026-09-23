import { useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { getAllLibraryEntries, getCatalogEntry, getSagaNames, getSyncStates, readRoutes, scanFolderContents, scanAllGames, readMetadataIndex, readEmulatorsConfig } from '../../lib/tauri';
import { toCatalogSummary, type CatalogSummary, type DbMediaRelation } from '../../lib/tauri';
import { getCachedLibraryAndCatalog, getCachedMediaRelations } from '../../lib/profile/library-data-cache';
import { syncActiveRatingSystemFromCachedInfo } from '../../lib/profile/user-info';
import { buildInProgressIdsKey } from '../../lib/profile/playability-key';
import { filterCoverCacheCandidates } from '../../lib/profile/cover-cache';
import { useCoverCacheBatch } from '../local/hooks/useCoverCacheBatch';
import { notifyNewEpisode } from '../../lib/notifications/notifications';
import { getT } from '../../i18n/runtime';
import { SORT_ICON_SCORE, SORT_ICON_DATE, SORT_ICON_DURATION, GROUP_EDITIONS_ICON, GROUP_BUNDLE_ICON, RATING_SLOT_1_ICON, RATING_SLOT_2_ICON } from '../../lib/dom/icon-strings';
import {
  isLibraryGroupByBundleEnabled, setLibraryGroupByBundleEnabled,
  isDualRatingEnabled, getRatingName1, getRatingName2,
  getActiveRatingSlot, setActiveRatingSlot, type RatingSlot,
  isUnifySeasonsEnabled,
} from '../../lib/storage/preferences';
import { getTypeLabel, ALL_MEDIA_TYPES, isInProgressStatus } from '../../lib/media/media-types';
import { getItemMinutes } from '../../lib/profile/stats-calculators';
import { needsResync } from '../../lib/media/media-status';
import { fetchMediaData } from '../../lib/media/media-page-data';
import { isSagaComponentRelationType } from '../../lib/media/saga/saga-relation-types';
import { createUnionFind } from '../../lib/shared/collections/union-find';
import { groupEditions, groupBundles, refineSagaGroups, averageRating, unifyAnimeSeasons, unifyEventSeasons } from '../../lib/profile/library-grouping';
import { compareByReleaseDateDesc, catalogReleaseTimestampMs } from '../../lib/media/mappers/mapper-utils';
import { STORAGE_KEYS } from '../../lib/storage/storage-keys';
import { LibraryCard, LibraryTypeIcon } from './LibraryCard';
import { VirtualLibraryGrid } from './VirtualLibraryGrid';
import { buildLibraryStatusEntries } from '../../lib/local/catalog-game-linking';
import { LOCAL_CATEGORY_BY_MEDIA_TYPE } from '../../lib/local/platforms';
import { isLocalMediaItemPlayable, toLocalMediaItem } from './library-playability';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type SortBy = 'rating' | 'date' | 'duration';

function normalizeAniListLibraryTypes(items: Items | null): Items | null {
  if (!items) return items;
  return items.map(item => {
    const prefix = item.external_id.slice(0, item.external_id.indexOf(':'));
    if ((prefix === 'anime' || prefix === 'manga' || prefix === 'lnovel') && item.type !== prefix) {
      return { ...item, type: prefix };
    }
    return item;
  });
}

// A fixed subset of media_catalog.format values — anything else (or unset) passes through untouched.
// .library-edition-filters is a single-column list (one button per row) —
// OVA/ONA are the one deliberate exception, rendered as their own shared
// row split into 2 sub-columns (see the "ONA" special-case in the render
// below) since they're different enough from each other to want separate
// toggles, but similar enough to not each deserve a full row of their own.
// Order otherwise just reads top-to-bottom as loose groups: "release
// format" (Main/Ova+Ona/Special), then "alternate version"/"sub-work"
// (Remaster/Remake/Expanded Game/Season/Update/Issue).
const EDITION_FILTER_OPTIONS = [
  { key: 'MAIN', label: 'Main' },
  { key: 'ONA', label: 'ONA' },
  { key: 'OVA', label: 'OVA' },
  { key: 'SPECIAL', label: 'Special' },
  { key: 'REMASTER', label: 'Remaster' },
  { key: 'REMAKE', label: 'Remake' },
  { key: 'EXPANDED_GAME', label: 'Expanded Game' },
  { key: 'SEASON', label: 'Season' },
  { key: 'UPDATE', label: 'Update' },
  { key: 'ISSUE', label: 'Issue' },
] as const;
const EDITION_FILTER_KEYS: Set<string> = new Set(EDITION_FILTER_OPTIONS.map(o => o.key));
const DEFAULT_EDITION_FILTERS = ['MAIN', 'OVA', 'ONA', 'SPECIAL', 'REMAKE', 'EXPANDED_GAME', 'REMASTER'];
// Base release formats across every media type — all bucket into the "Main" filter
// instead of only matching the untyped/GAME fallback (anime/manga almost always have
// an explicit format like TV/MANGA/NOVEL, so they never hit that fallback).
const MAIN_EDITION_FORMATS = new Set([
  'GAME', 'TV', 'TV_SHORT', 'MOVIE', 'MANGA', 'ONE_SHOT', 'NOVEL',
  'VISUAL_NOVEL', 'TV_MOVIE', 'SHORT_FILM', 'MINISERIES',
]);
function normalizeEditionFormat(format: string | null | undefined): string {
  if (!format || MAIN_EDITION_FORMATS.has(format)) return 'MAIN';
  return format;
}

interface LibrarySectionProps {
  // Someone else's profile (UserProfileView) already has their mapped
  // library, the viewer's own catalogMap, and catalog-wide saga/relation
  // data in hand — passing them in skips this component's own local-only
  // fetch (and the resync-on-view / new-episode-notification side effects
  // below, which refresh the shared catalog and notify about "your"
  // library, neither of which make sense for a page you're just visiting).
  // readOnly disables click-to-edit on every card (see LibraryCard).
  overrideItems?: Items;
  overrideCatalogMap?: Map<string, CatalogSummary>;
  overrideSagaRelations?: DbMediaRelation[];
  overrideSagaNames?: Record<string, string>;
  readOnly?: boolean;
}

export function LibrarySection({
  overrideItems, overrideCatalogMap, overrideSagaRelations, overrideSagaNames, readOnly,
}: LibrarySectionProps = {}) {
  const p = getT().profile;
  const typeLabels = getT().search.types;
  const STATUS_LIST = useMemo(() => [
    { key: '', label: p.section_all },
    { key: 'planning', label: p.status_planning },
    { key: 'in_progress', label: p.section_in_progress },
    { key: 'completed', label: p.status_completed },
    { key: 'paused', label: p.status_paused },
    { key: 'dropped', label: p.status_dropped },
  ], [p]);

  const [items, setItems] = useState<Items | null>(overrideItems ?? null);
  const libraryItems = useMemo(() => normalizeAniListLibraryTypes(items), [items]);
  const [catalogMap, setCatalogMap] = useState<Map<string, CatalogSummary>>(overrideCatalogMap ?? new Map());
  const [sagaRelations, setSagaRelations] = useState<DbMediaRelation[]>(overrideSagaRelations ?? []);
  const [sagaNames, setSagaNames] = useState<Record<string, string>>(overrideSagaNames ?? {});
  const [playableResumeIds, setPlayableResumeIds] = useState<ReadonlySet<string>>(() => new Set());

  const issueRelationsByMedia = useMemo(() => {
    const byMedia = new Map<string, DbMediaRelation[]>();
    for (const relation of sagaRelations) {
      if (relation.relation_type !== 'ISSUE' || !relation.media_external_id) continue;
      const issues = byMedia.get(relation.media_external_id) ?? [];
      issues.push(relation);
      byMedia.set(relation.media_external_id, issues);
    }
    return byMedia;
  }, [sagaRelations]);

  const [nameFilter, setNameFilter] = useState('');
  const deferredNameFilter = useDeferredValue(nameFilter);
  const [activeTypeTab, setActiveTypeTab] = useState('');
  const [selectedEditionFormats, setSelectedEditionFormats] = useState<string[]>(DEFAULT_EDITION_FILTERS);
  const [statusIndex, setStatusIndex] = useState(0);
  // "YYYY-MM-DD" strings straight from <input type="date">, or '' when unset
  // — parsed to a timestamp only at filter time (see the `filtered` useMemo
  // below), same as every other filter here staying in its raw input shape
  // until it's actually applied.
  const [startDateFilter, setStartDateFilter] = useState('');
  const [endDateFilter, setEndDateFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [groupByEdition, setGroupByEdition] = useState(false);
  const [groupByBundle, setGroupByBundle] = useState(overrideItems ? false : isLibraryGroupByBundleEnabled);
  const toggleGroupByBundle = () => setGroupByBundle(prev => {
    const next = !prev;
    setLibraryGroupByBundleEnabled(next);
    return next;
  });

  // Settings > Preferencias' opt-in "doble calificación" — the selector to
  // pick which one this view sorts/displays by only shows up at all once
  // enabled there (someone else's profile, via overrideItems, has no
  // concept of the viewer's own dual-rating setup, so it's never relevant
  // on a read-only view either).
  const dualRatingEnabled = !overrideItems && isDualRatingEnabled();
  const [ratingSlot, setRatingSlotState] = useState<RatingSlot>(getActiveRatingSlot);
  const changeRatingSlot = (slot: RatingSlot) => {
    setActiveRatingSlot(slot);
    setRatingSlotState(slot);
  };
  const settingsT = getT().settings;
  const ratingSlotLabel = (slot: RatingSlot) =>
    slot === 'rating_2'
      ? getRatingName2(settingsT.dual_rating_default_name2)
      : getRatingName1(settingsT.dual_rating_default_name1);

  // The navbar's per-type library shortcuts (Navbar.astro) deep-link here as
  // /profile?libtype=<type>#library. profile.astro's switchTab() strips that
  // query string via replaceState before this component ever mounts, so it
  // can't be read from location.search here — profile.astro stashes it in
  // sessionStorage instead, read once on mount and discarded.
  useEffect(() => {
    if (overrideItems) return;
    const libtype = sessionStorage.getItem(STORAGE_KEYS.pendingLibraryType);
    if (!libtype) return;
    setActiveTypeTab(libtype);
    sessionStorage.removeItem(STORAGE_KEYS.pendingLibraryType);
  }, [overrideItems]);

  // Which covers Local already cached to disk (one exists-only IPC call for
  // the whole library, see useCoverCacheBatch) — those cards load the local
  // webp instead of hitting the remote CDN on every visit, exactly like
  // Local's own grids. Misses keep their remote URL.
  const coverCacheIds = useMemo(
    () => filterCoverCacheCandidates(libraryItems ? libraryItems.map(item => item.external_id) : []),
    [libraryItems],
  );
  const coverCacheHits = useCoverCacheBatch(coverCacheIds);

  // Keep the shortcut strictly in sync with Local / Play's real sources:
  // installed/scannable games for game entries, and a matched next file in
  // the configured category folder for media entries. Until detection ends,
  // no play icon is shown rather than advertising an unavailable action.
  //
  // Keyed on the SET of in-progress ids (a stable string), not on the
  // library/catalog/relations references: the resync loop below replaces
  // catalogMap once per refreshed entry, and every one of those used to
  // re-run this whole detection — read_routes, a scan_folder_contents per
  // category, scan_all_games (registry + directory walks), the metadata
  // index — for a result that only ever changes when the in-progress set
  // does. The other inputs are read through a ref, refreshed every render.
  const inProgressIdsKey = useMemo(() => buildInProgressIdsKey(libraryItems), [libraryItems]);
  const detectionInputsRef = useRef({ libraryItems, catalogMap, sagaRelations });
  useEffect(() => {
    detectionInputsRef.current = { libraryItems, catalogMap, sagaRelations };
  }, [libraryItems, catalogMap, sagaRelations]);
  useEffect(() => {
    const { libraryItems, catalogMap, sagaRelations } = detectionInputsRef.current;
    if (readOnly || !libraryItems) {
      setPlayableResumeIds(new Set());
      return;
    }
    setPlayableResumeIds(new Set());
    const candidates = libraryItems.filter(entry => isInProgressStatus(entry.status));
    if (candidates.length === 0) {
      setPlayableResumeIds(new Set());
      return;
    }

    let cancelled = false;
    const detectPlayableItems = async () => {
      const playableIds = new Set<string>();
      const routes = await readRoutes().catch(() => ({} as Record<string, string>));
      const mediaCandidates = candidates.filter(entry => entry.type !== 'game' && entry.type !== 'vnovel');
      const categories = [...new Set(mediaCandidates.map(entry => LOCAL_CATEGORY_BY_MEDIA_TYPE[entry.type]).filter((category): category is NonNullable<typeof category> => !!category))];
      const rootEntriesByCategory = new Map<string, Awaited<ReturnType<typeof scanFolderContents>>>();
      await Promise.all(categories.map(async category => {
        const rootPath = routes[category];
        if (!rootPath) return;
        const entries = await scanFolderContents(rootPath).catch(() => []);
        rootEntriesByCategory.set(category, entries);
      }));

      const mediaResults = await Promise.all(mediaCandidates.map(async entry => {
        const category = LOCAL_CATEGORY_BY_MEDIA_TYPE[entry.type];
        const rootPath = category ? routes[category] : undefined;
        const rootEntries = category ? rootEntriesByCategory.get(category) : undefined;
        if (!rootPath || !rootEntries) return null;
        const mediaItem = toLocalMediaItem(entry, catalogMap.get(entry.external_id));
        return await isLocalMediaItemPlayable(mediaItem, rootPath, rootEntries) ? entry.external_id : null;
      }));
      mediaResults.forEach(id => { if (id) playableIds.add(id); });

      const gameCandidates = candidates.filter(entry => entry.type === 'game' || entry.type === 'vnovel');
      if (gameCandidates.length > 0) {
        const [games, pathCache, emulators] = await Promise.all([
          scanAllGames().catch(() => []),
          readMetadataIndex().catch(() => ({} as Awaited<ReturnType<typeof readMetadataIndex>>)),
          readEmulatorsConfig().catch(() => ({} as Awaited<ReturnType<typeof readEmulatorsConfig>>)),
        ]);
        for (const entry of gameCandidates) {
          const statusEntry = buildLibraryStatusEntries(
            [toLocalMediaItem(entry, catalogMap.get(entry.external_id))],
            games,
            catalogMap,
            pathCache,
            sagaRelations,
          )[0];
          const game = statusEntry?.kind === 'game' ? statusEntry.game
            : statusEntry?.kind === 'catalog' ? statusEntry.launchGame
            : undefined;
          if (!game || game.installed === false || (!game.app_id && !game.install_path)) continue;
          if (game.rom_platform && !game.install_path?.toLowerCase().endsWith('.exe')
            && !emulators[game.rom_platform]?.executable_path) continue;
          playableIds.add(entry.external_id);
        }
      }

      if (!cancelled) setPlayableResumeIds(playableIds);
    };

    detectPlayableItems().catch(error => console.error('[LibrarySection] Local playability detection failed:', error));
    return () => { cancelled = true; };
  }, [inProgressIdsKey, readOnly]);

  useEffect(() => {
    if (overrideItems) return;
    let cancelled = false;

    const load = async () => {
      const [{ items: rawItems, catalog: catalogEntries }, relations] = await Promise.all([
        getCachedLibraryAndCatalog(),
        getCachedMediaRelations(),
      ]);
      // Refreshes the localStorage cache read by getActiveRatingSystem() per-card below.
      await syncActiveRatingSystemFromCachedInfo();
      if (cancelled) return;
      const catalogById = new Map(catalogEntries.map(e => [e.external_id, e]));
      setItems(rawItems);
      setCatalogMap(catalogById);
      setSagaRelations(relations);
      getSagaNames(rawItems.map(i => i.external_id)).then(names => { if (!cancelled) setSagaNames(names); }).catch(() => {});

      // Entering the library is the other trigger point (besides the media
      // page) for needsResync()'s cadence — scoped to in-progress entries,
      // sequential with a short stagger to avoid bursting AniList's rate limit.
      // One batched sync_state lookup instead of a per-item round trip.
      const inProgressItems = rawItems.filter(item => isInProgressStatus(item.status));
      const syncStates = await getSyncStates(inProgressItems.map(i => i.external_id)).catch(() => []);
      const syncStateMap = new Map(syncStates.map(s => [s.external_id, s]));
      const dueForResync = inProgressItems.filter(item => {
        const catalog = catalogById.get(item.external_id);
        const sync = syncStateMap.get(item.external_id);
        return needsResync(sync ? { status: catalog?.status, last_synced_at: sync.last_synced_at, sync_failed_count: sync.sync_failed_count } : null);
      });

      for (const item of dueForResync) {
        if (cancelled) return;
        const before = catalogById.get(item.external_id);
        await fetchMediaData(item.external_id).catch(() => null);
        const fresh = await getCatalogEntry(item.external_id).catch(() => null);
        if (cancelled) return;
        if (fresh) {
          setCatalogMap(prev => new Map(prev).set(fresh.external_id, toCatalogSummary(fresh)));
          // total_count went up — a new episode/chapter aired.
          const beforeCount = before?.total_count ?? 0;
          const afterCount = fresh.total_count ?? 0;
          if (beforeCount > 0 && afterCount > beforeCount) {
            const n = getT().notifications;
            const label = (item.type === 'manga' || item.type === 'lnovel' ? n.new_chapter : n.new_episode)
              .replace('{number}', String(afterCount));
            notifyNewEpisode(fresh.title_main || item.external_id, label).catch(() => {});
          }
        }
        await new Promise(resolve => setTimeout(resolve, 400));
      }
    };

    load();

    // Fired by ProfileLibraryEditor after a save/delete — re-fetches in place instead of remounting the whole grid.
    window.addEventListener('refresh-profile-library', load);
    return () => {
      cancelled = true;
      window.removeEventListener('refresh-profile-library', load);
    };
  }, [overrideItems]);

  // Same union-find approach as refineSagaGroups (SEQUEL/PREQUEL/ALTERNATIVE
  // chains) but just to answer "are these two the same saga" for the date-sort
  // tiebreaker below — grouping stays a separate, opt-in concern.
  const sagaComponentOf = useMemo(() => {
    const sagaGraph = createUnionFind<string>();
    for (const rel of sagaRelations) {
      if (!isSagaComponentRelationType(rel.relation_type)) continue;
      if (!rel.media_external_id) continue;
      sagaGraph.union(rel.media_external_id, rel.related_media_external_id);
    }
    return (id: string) => (sagaGraph.has(id) ? sagaGraph.find(id) : null);
  }, [sagaRelations]);

  const sections = useMemo(() => {
    if (!libraryItems) return null;

    const nameVal = deferredNameFilter.toLowerCase().trim();
    const statusKey = STATUS_LIST[statusIndex].key;
    const startTs = startDateFilter ? new Date(startDateFilter).getTime() : null;
    const endTsExclusive = endDateFilter ? new Date(endDateFilter).getTime() + 24 * 60 * 60 * 1000 : null;

    // Precompute filter predicates to avoid repeated function calls
    const filtered = libraryItems.filter(item => {
      const meta = catalogMap.get(item.external_id);
      const title = (meta?.title_main ?? item.external_id).toLowerCase();
      if (nameVal && !title.includes(nameVal)) return false;
      if (activeTypeTab && item.type !== activeTypeTab) return false;
      const editionFormat = normalizeEditionFormat(meta?.format);
      if (EDITION_FILTER_KEYS.has(editionFormat) && !selectedEditionFormats.includes(editionFormat)) return false;
      if (statusKey) {
        if (statusKey === 'in_progress') { if (!isInProgressStatus(item.status)) return false; }
        else if (item.status !== statusKey) return false;
      }
      // "Desde" only rules out entries that either never started or started
      // earlier — nothing to say about when/whether they finished. "Hasta"
      // is the mirror: only rules out entries that never finished or
      // finished later. Setting both narrows to entries that started on/
      // after "Desde" AND finished on/before "Hasta" — i.e. actually
      // watched/read within that window, not just touched at some point
      // during it.
      if (startTs !== null) {
        const startedAt = item.started_at ? new Date(item.started_at).getTime() : null;
        if (startedAt === null || startedAt < startTs) return false;
      }
      if (endTsExclusive !== null) {
        const finishedAt = item.finished_at ? new Date(item.finished_at).getTime() : null;
        if (finishedAt === null || finishedAt >= endTsExclusive) return false;
      }
      return true;
    });

    if (filtered.length === 0) return [];

    // "Unificar temporadas" runs on the WHOLE owned list, before the status
    // split below — see unifyAnimeSeasons's own doc comment for why (a
    // season-1-completed/season-3-watching chain must resolve to exactly one
    // card in ONE section, not race to appear in two once each is filtered
    // into a different status bucket first).
    const animeSeasonGroups = isUnifySeasonsEnabled()
      ? unifyAnimeSeasons(filtered, catalogMap, sagaRelations, sagaNames)
      : { consumedIds: new Set<string>(), groups: [] };
    const eventSeasonGroups = isUnifySeasonsEnabled()
      ? unifyEventSeasons(filtered, catalogMap)
      : { consumedIds: new Set<string>(), groups: [] };
    const seasonConsumedIds = new Set([...animeSeasonGroups.consumedIds, ...eventSeasonGroups.consumedIds]);
    const seasonGroups = [...animeSeasonGroups.groups, ...eventSeasonGroups.groups];
    const unmergedFiltered = seasonConsumedIds.size > 0
      ? filtered.filter(i => !seasonConsumedIds.has(i.external_id))
      : filtered;

    const releaseTimestamp = (i: Items[number]): number => catalogReleaseTimestampMs(catalogMap.get(i.external_id)) ?? 0;

    const unknownDateLast = (dateA: number, dateB: number): number | null => {
      if (dateA === 0 && dateB !== 0) return 1;
      if (dateB === 0 && dateA !== 0) return -1;
      return null;
    };

    const sortItems = (itemList: Items, useStartDate = false) => {
      if (itemList.length === 0) return itemList;
      return [...itemList].sort((a, b) => {
      if (sortBy === 'rating') {
        return dualRatingEnabled && ratingSlot === 'rating_2'
          ? (b.rating_2 ?? 0) - (a.rating_2 ?? 0)
          : (b.rating ?? 0) - (a.rating ?? 0);
      }
      if (sortBy === 'duration') return getItemMinutes(b, catalogMap) - getItemMinutes(a, catalogMap);
      const dateField = useStartDate ? 'started_at' : 'finished_at';
      const dateA = a[dateField] ? new Date(a[dateField] as string).getTime() : releaseTimestamp(a);
      const dateB = b[dateField] ? new Date(b[dateField] as string).getTime() : releaseTimestamp(b);
      const unknownCmp = unknownDateLast(dateA, dateB);
      if (unknownCmp !== null) return unknownCmp;
      if (dateA === dateB && dateA !== 0) {
        // Same finished date + same saga: break the tie by release order
        // instead of leaving it arbitrary, so e.g. Season 1 sits below
        // Season 2 rather than the order flip-flopping on every reload.
        const compA = sagaComponentOf(a.external_id);
        const compB = sagaComponentOf(b.external_id);
        if (compA && compA === compB) {
          return compareByReleaseDateDesc(catalogMap.get(a.external_id) ?? {}, catalogMap.get(b.external_id) ?? {});
        }
      }
      return dateB - dateA;
      });
    };

    const isPublishing = (i: Items[number]) => catalogMap.get(i.external_id)?.status === 'RELEASING';

    const sectionsData = [
      { title: p.section_publishing, items: sortItems(unmergedFiltered.filter(i => isInProgressStatus(i.status) && isPublishing(i)), true), isCompletedSection: false, isCurrently: true },
      { title: p.section_in_progress, items: sortItems(unmergedFiltered.filter(i => isInProgressStatus(i.status) && !isPublishing(i)), true), isCompletedSection: false, isCurrently: true },
      { title: p.section_completed, items: sortItems(unmergedFiltered.filter(i => i.status === 'completed')), isCompletedSection: true, isCurrently: false },
      { title: p.section_planning, items: sortItems(unmergedFiltered.filter(i => i.status === 'planning')), isCompletedSection: false, isCurrently: false },
      { title: p.section_paused, items: sortItems(unmergedFiltered.filter(i => i.status === 'paused')), isCompletedSection: false, isCurrently: false },
      { title: p.section_dropped, items: sortItems(unmergedFiltered.filter(i => i.status === 'dropped')), isCompletedSection: false, isCurrently: false },
    ];

    // Every completed work's own id — regardless of the current name/type/
    // edition filters, which shouldn't change whether a saga/bundle
    // elsewhere in the library already has a finished anchor. Used below to
    // suppress merging in every OTHER section: a saga/bundle with a
    // completed member shouldn't also show as one aggregate card among your
    // dropped/pending/paused/in-progress ones — each of those stays its own
    // individual entry instead of being folded together, since "Completado"
    // already represents that saga/bundle's own real anchor point.
    const completedIds = new Set((libraryItems ?? []).filter(i => i.status === 'completed').map(i => i.external_id));

    // Places each unified season card in the same section its winning
    // member's own status would normally land in — same rules sectionsData
    // itself just used, applied to statusSourceItem instead of every raw item.
    const seasonCardsByTitle = new Map<string, typeof seasonGroups>();
    for (const group of seasonGroups) {
      const src = group.statusSourceItem;
      const title = isInProgressStatus(src.status) && isPublishing(src) ? p.section_publishing
        : isInProgressStatus(src.status) ? p.section_in_progress
        : src.status === 'completed' ? p.section_completed
        : src.status === 'planning' ? p.section_planning
        : src.status === 'paused' ? p.section_paused
        : src.status === 'dropped' ? p.section_dropped
        : null;
      if (!title) continue;
      const list = seasonCardsByTitle.get(title) ?? [];
      list.push(group);
      seasonCardsByTitle.set(title, list);
    }

    return sectionsData
      .filter(sec => sec.items.length > 0 || (seasonCardsByTitle.get(sec.title)?.length ?? 0) > 0)
      // Edition/saga-chain grouping is gated behind "Agrupar por entrega"; bundle grouping has its own toggle.
      .map(sec => {
        const suppressIds = sec.isCompletedSection ? undefined : completedIds;
        const editionGroups = groupEditions(sec.items, catalogMap, groupByEdition);
        let cards: Array<{ item: Items[number]; grouped: Items[number][]; bundleMeta?: CatalogSummary; titleOverride?: string; aggregateStats?: boolean; hideGroupBadge?: boolean; mediaExternalId?: string }> = editionGroups;
        if (groupByBundle) {
          cards = groupBundles(cards, catalogMap, sagaRelations, suppressIds);
        }
        if (groupByEdition) {
          cards = refineSagaGroups(cards, catalogMap, sagaRelations, sagaNames, suppressIds);
        }
        // Unified season cards for this section — already fully formed
        // (earliest-release representative, aggregate stats, unified
        // status), so they skip groupEditions/groupBundles/refineSagaGroups
        // entirely instead of being reprocessed by them.
        for (const group of seasonCardsByTitle.get(sec.title) ?? []) {
          cards.push({ item: group.item, grouped: group.grouped, titleOverride: group.titleOverride, aggregateStats: true, hideGroupBadge: true, mediaExternalId: group.mediaExternalId });
        }

        // groupBundles/refineSagaGroups append merged cards regardless of date/rating — re-sort using the group's aggregate.
        const sectionUsesStartDate = sec.title === p.section_publishing || sec.title === p.section_in_progress;
        cards = [...cards].sort((a, b) => {
          const isAggA = !!a.bundleMeta || !!a.aggregateStats;
          const isAggB = !!b.bundleMeta || !!b.aggregateStats;
          const aWorks = isAggA ? (a.bundleMeta ? a.grouped : [a.item, ...a.grouped]) : [a.item];
          const bWorks = isAggB ? (b.bundleMeta ? b.grouped : [b.item, ...b.grouped]) : [b.item];
          if (sortBy === 'rating') {
            const activeSlot = dualRatingEnabled && ratingSlot === 'rating_2' ? 'rating_2' : 'rating';
            return (averageRating(bWorks, activeSlot) ?? 0) - (averageRating(aWorks, activeSlot) ?? 0);
          }
          if (sortBy === 'duration') {
            const sum = (arr: Items[number][]) => arr.reduce((acc, it) => acc + getItemMinutes(it, catalogMap), 0);
            return sum(bWorks) - sum(aWorks);
          }
          const dateField = sectionUsesStartDate ? 'started_at' : 'finished_at';
          const latestDate = (arr: Items[number][]) => Math.max(0, ...arr.map(it => it[dateField] ? new Date(it[dateField] as string).getTime() : 0));
          const dateA = latestDate(aWorks);
          const dateB = latestDate(bWorks);
          const unknownCmp = unknownDateLast(dateA, dateB);
          if (unknownCmp !== null) return unknownCmp;
          return dateB - dateA;
        });

        return { title: sec.title, cards, isCurrently: sec.isCurrently };
      });
  }, [libraryItems, catalogMap, sagaRelations, sagaComponentOf, sagaNames, deferredNameFilter, activeTypeTab, selectedEditionFormats, statusIndex, startDateFilter, endDateFilter, sortBy, groupByEdition, groupByBundle, dualRatingEnabled, ratingSlot, STATUS_LIST, p]);

  const presentTypes = useMemo(() => {
    if (!libraryItems) return [];
    const present = new Set(libraryItems.map(i => i.type));
    return ALL_MEDIA_TYPES.filter(t => present.has(t));
  }, [libraryItems]);

  if (items === null) return null;

  if (items.length === 0) {
    return (
      <div className="profile-empty">
        <span className="profile-empty-icon">📚</span>
        <p>{p.empty}</p>
        {!readOnly && <a href="/search">{p.empty_cta}</a>}
      </div>
    );
  }

  return (
    <div className="library-layout">
      <aside className="library-filters">
        <p className="library-filters-title">{p.library_filters}</p>

        <div className="library-filter-group">
          <label className="library-filter-label" htmlFor="filter-name">{p.library_filter_name}</label>
          <input
            type="text"
            id="filter-name"
            className="library-filter-input"
            placeholder={p.library_filter_name_ph}
            value={nameFilter}
            onChange={e => setNameFilter(e.target.value)}
          />
        </div>

        <div className="library-filter-group">
          <label className="library-filter-label">{p.library_filter_edition_type}</label>
          <div className="library-edition-filters">
            {EDITION_FILTER_OPTIONS.map(opt => {
              // OVA is rendered paired with ONA below instead of getting
              // its own slot in the outer 2-column grid — the one option
              // that shares a slot instead of getting one to itself.
              if (opt.key === 'OVA') return null;
              const button = (o: typeof EDITION_FILTER_OPTIONS[number]) => (
                <button
                  key={o.key}
                  type="button"
                  className={`library-edition-btn ${selectedEditionFormats.includes(o.key) ? 'active' : ''}`}
                  onClick={() => setSelectedEditionFormats(prev =>
                    prev.includes(o.key) ? prev.filter(k => k !== o.key) : [...prev, o.key]
                  )}
                >
                  {(getT().media?.formats as Record<string, string>)?.[o.key] || o.label}
                </button>
              );
              if (opt.key === 'ONA') {
                const ova = EDITION_FILTER_OPTIONS.find(o => o.key === 'OVA')!;
                return (
                  <div className="library-edition-pair" key="ona-ova-pair">
                    {button(opt)}
                    {button(ova)}
                  </div>
                );
              }
              return button(opt);
            })}
          </div>
        </div>

        <div className="library-filter-group">
          <label className="library-filter-label">{p.library_filter_status}</label>
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
          <label className="library-filter-label">{p.library_filter_date_range}</label>
          <div className="library-date-range">
            <label className="library-date-field">
              <span className="library-date-field-label">{p.library_filter_date_from}</span>
              <input
                type="date"
                className="library-filter-date-input"
                value={startDateFilter}
                max={endDateFilter || undefined}
                onChange={e => setStartDateFilter(e.target.value)}
              />
            </label>
            <label className="library-date-field">
              <span className="library-date-field-label">{p.library_filter_date_to}</span>
              <input
                type="date"
                className="library-filter-date-input"
                value={endDateFilter}
                min={startDateFilter || undefined}
                onChange={e => setEndDateFilter(e.target.value)}
              />
            </label>
          </div>
        </div>
      </aside>

      <div className="library-content">
        <div className="library-content-header">
          <div className="library-type-tabs">
            <button
              type="button"
              className={`library-type-tab ${activeTypeTab === '' ? 'active' : ''}`}
              onClick={() => setActiveTypeTab('')}
            >
              {typeLabels.all}
            </button>
            {presentTypes.map(type => (
              <button
                key={type}
                type="button"
                className={`library-type-tab ${activeTypeTab === type ? 'active' : ''}`}
                onClick={() => setActiveTypeTab(type)}
              >
                <LibraryTypeIcon type={type} />
                {typeLabels[type as keyof typeof typeLabels] || getTypeLabel(type)}
              </button>
            ))}
          </div>
          {dualRatingEnabled && (
            <>
              <div className="library-rating-slot-toggle">
                <span className="library-sort-label">{p.library_sort_rating}</span>
                <div className="library-group-toggle-icons">
                  <button
                    type="button"
                    className={`library-group-toggle-btn ${ratingSlot === 'rating' ? 'active' : ''}`}
                    title={ratingSlotLabel('rating')}
                    onClick={() => changeRatingSlot('rating')}
                    dangerouslySetInnerHTML={{ __html: RATING_SLOT_1_ICON }}
                  />
                  <button
                    type="button"
                    className={`library-group-toggle-btn ${ratingSlot === 'rating_2' ? 'active' : ''}`}
                    title={ratingSlotLabel('rating_2')}
                    onClick={() => changeRatingSlot('rating_2')}
                    dangerouslySetInnerHTML={{ __html: RATING_SLOT_2_ICON }}
                  />
                </div>
              </div>
              <div className="library-header-divider" />
            </>
          )}
          <div className="library-group-toggles">
            <span className="library-sort-label">{p.library_group_by}</span>
            <div className="library-group-toggle-icons">
              <button
                type="button"
                className={`library-group-toggle-btn ${groupByEdition ? 'active' : ''}`}
                title={p.library_group_editions}
                onClick={() => setGroupByEdition(g => !g)}
                dangerouslySetInnerHTML={{ __html: GROUP_EDITIONS_ICON }}
              />
              <button
                type="button"
                className={`library-group-toggle-btn ${groupByBundle ? 'active' : ''}`}
                title={p.library_group_bundle}
                onClick={toggleGroupByBundle}
                dangerouslySetInnerHTML={{ __html: GROUP_BUNDLE_ICON }}
              />
            </div>
          </div>
          <div className="library-header-divider" />
          <div className="library-filter-group select-sort">
            <span className="library-sort-label">{p.library_sort_by}</span>
            <div className="library-sort-options">
              <button type="button" className={`library-sort-btn ${sortBy === 'rating' ? 'active' : ''}`} title={p.library_sort_rating} onClick={() => setSortBy('rating')} dangerouslySetInnerHTML={{ __html: SORT_ICON_SCORE }} />
              <button type="button" className={`library-sort-btn ${sortBy === 'date' ? 'active' : ''}`} title={p.library_sort_date} onClick={() => setSortBy('date')} dangerouslySetInnerHTML={{ __html: SORT_ICON_DATE }} />
              <button type="button" className={`library-sort-btn ${sortBy === 'duration' ? 'active' : ''}`} title={p.library_sort_duration} onClick={() => setSortBy('duration')} dangerouslySetInnerHTML={{ __html: SORT_ICON_DURATION }} />
            </div>
          </div>
        </div>
        <div className="library-sections-list">
          {sections && sections.length === 0 && (
            <div className="library-empty-filtered">{p.library_no_results}</div>
          )}
          {sections?.map(sec => (
            <div className="library-section" key={sec.title}>
              <h3 className="library-section-title">{sec.title}</h3>
              <VirtualLibraryGrid
                entries={sec.cards}
                // Prefixed for a bundle card specifically (not just
                // bundleMeta.external_id bare) — a bundle container can ALSO
                // be tracked as its own standalone library entry at the same
                // time (e.g. Final Fantasy VII Remake Intergrade logged
                // directly, while its children Remake + Episode Intermission
                // also form their own aggregate bundle card using
                // Intergrade's own catalog id as bundleMeta) — the bare id
                // collided with that standalone card's own key, and two
                // siblings sharing a key is exactly what made React's
                // reconciliation leave stale duplicate DOM nodes behind
                // across re-renders (worse each time "Agrupar por bundle"
                // was toggled, since that's exactly when this list changes
                // shape). Still keyed by bundleMeta over `item` for a bundle
                // card (not item.external_id, which can itself change
                // representative when "Agrupar por edición" toggles) so the
                // card's identity — and any hover/flyout state — stays
                // stable across that specific toggle instead of remounting.
                getKey={({ item, bundleMeta }) => bundleMeta ? `bundle:${bundleMeta.external_id}` : item.external_id}
                renderItem={({ item, grouped, bundleMeta, titleOverride, aggregateStats, hideGroupBadge, mediaExternalId }) => (
                  <LibraryCard
                    item={item}
                    grouped={grouped}
                    bundleMeta={bundleMeta}
                    titleOverride={titleOverride}
                    aggregateStats={aggregateStats}
                    hideGroupingUi={hideGroupBadge}
                    mediaExternalId={mediaExternalId}
                    catalogMap={catalogMap}
                    p={p}
                    readOnly={readOnly}
                    showResumeAction={sec.isCurrently}
                    playableResumeIds={playableResumeIds}
                    cachedCoverPath={coverCacheHits[item.external_id]}
                    issueRelations={issueRelationsByMedia.get(item.external_id)}
                    ratingSlot={dualRatingEnabled ? ratingSlot : 'rating'}
                  />
                )}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
