import { useEffect, useMemo, useState } from 'react';
import { getAllLibraryEntries, getAllMediaRelations, getCatalogEntry, getSagaNames, getSyncStates } from '../../lib/tauri';
import type { MediaCatalogEntry, DbMediaRelation } from '../../lib/tauri';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { notifyNewEpisode } from '../../lib/shared/notifications';
import { getT } from '../../i18n/client';
import { syncActiveRatingSystem } from '../../lib/media/rating-utils';
import { SORT_ICON_SCORE, SORT_ICON_DATE, SORT_ICON_DURATION, GROUP_EDITIONS_ICON, GROUP_BUNDLE_ICON } from '../../lib/shared/icon-strings';
import { isLibraryGroupByBundleEnabled, setLibraryGroupByBundleEnabled } from '../../lib/settings/preferences';
import { getTypeLabel, ALL_MEDIA_TYPES, isInProgressStatus } from '../../lib/constants/media';
import { getItemMinutes } from '../../lib/profile/stats-calculators';
import { needsResync, isCaughtUpOnReleasing } from '../../lib/media/media-status';
import { fetchMediaData } from '../../lib/media/mediaService';
import { groupEditions, groupBundles, refineSagaGroups, averageRating } from './library-grouping';
import { compareByReleaseDateDesc } from '../../lib/media/mapper-utils';
import { STORAGE_KEYS } from '../../lib/shared/storage-keys';
import { LibraryCard, TYPE_ICON } from './LibraryCard';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type SortBy = 'rating' | 'date' | 'duration';

// A fixed subset of media_catalog.format values — anything else (or unset) passes through untouched.
const EDITION_FILTER_OPTIONS = [
  { key: 'MAIN', label: 'Main' },
  { key: 'OVA', label: 'OVA' },
  { key: 'ONA', label: 'ONA' },
  { key: 'SPECIAL', label: 'Special' },
  { key: 'REMAKE', label: 'Remake' },
  { key: 'EXPANDED_GAME', label: 'Expanded Game' },
  { key: 'REMASTER', label: 'Remaster' },
  { key: 'UPDATE', label: 'Update' },
  { key: 'SEASON', label: 'Season' },
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
  overrideCatalogMap?: Map<string, MediaCatalogEntry>;
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
  const [catalogMap, setCatalogMap] = useState<Map<string, MediaCatalogEntry>>(overrideCatalogMap ?? new Map());
  const [sagaRelations, setSagaRelations] = useState<DbMediaRelation[]>(overrideSagaRelations ?? []);
  const [sagaNames, setSagaNames] = useState<Record<string, string>>(overrideSagaNames ?? {});

  const [nameFilter, setNameFilter] = useState('');
  const [activeTypeTab, setActiveTypeTab] = useState('');
  const [selectedEditionFormats, setSelectedEditionFormats] = useState<string[]>(DEFAULT_EDITION_FILTERS);
  const [statusIndex, setStatusIndex] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [groupByEdition, setGroupByEdition] = useState(false);
  const [groupByBundle, setGroupByBundle] = useState(overrideItems ? false : isLibraryGroupByBundleEnabled);
  const toggleGroupByBundle = () => setGroupByBundle(prev => {
    const next = !prev;
    setLibraryGroupByBundleEnabled(next);
    return next;
  });

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

  useEffect(() => {
    if (overrideItems) return;
    let cancelled = false;

    const load = async () => {
      const [{ items: rawItems, catalog: catalogEntries }, relations] = await Promise.all([
        getCachedLibraryAndCatalog(),
        getAllMediaRelations().catch(() => [] as DbMediaRelation[]),
      ]);
      // Refreshes the localStorage cache read by getActiveRatingSystem() per-card below.
      await syncActiveRatingSystem();
      if (cancelled) return;
      setItems(rawItems);
      setCatalogMap(new Map(catalogEntries.map(e => [e.external_id, e])));
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
        const catalog = catalogEntries.find(e => e.external_id === item.external_id);
        const sync = syncStateMap.get(item.external_id);
        return needsResync(sync ? { status: catalog?.status, last_synced_at: sync.last_synced_at, sync_failed_count: sync.sync_failed_count } : null);
      });

      for (const item of dueForResync) {
        if (cancelled) return;
        const before = catalogEntries.find(e => e.external_id === item.external_id);
        await fetchMediaData(item.external_id).catch(() => null);
        const fresh = await getCatalogEntry(item.external_id).catch(() => null);
        if (cancelled) return;
        if (fresh) {
          setCatalogMap(prev => new Map(prev).set(fresh.external_id, fresh));
          // total_count went up — a new episode/chapter aired.
          const beforeCount = before?.total_count ?? 0;
          const afterCount = fresh.total_count ?? 0;
          if (beforeCount > 0 && afterCount > beforeCount) {
            const label = item.type === 'manga' || item.type === 'lnovel'
              ? `Capítulo ${afterCount}`
              : `Episodio ${afterCount}`;
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
    for (const rel of sagaRelations) {
      const isSequel = rel.relation_type === 'SEQUEL' || rel.relation_type === 'SECUELA';
      const isPrequel = rel.relation_type === 'PREQUEL' || rel.relation_type === 'PRECUELA';
      const isAlternative = rel.relation_type === 'ALTERNATIVE';
      if (!isSequel && !isPrequel && !isAlternative) continue;
      if (!rel.media_external_id) continue;
      union(rel.media_external_id, rel.related_media_external_id);
    }
    return (id: string) => (parent.has(id) ? find(id) : null);
  }, [sagaRelations]);

  const sections = useMemo(() => {
    if (!items) return null;

    const nameVal = nameFilter.toLowerCase().trim();
    const statusKey = STATUS_LIST[statusIndex].key;

    const filtered = items.filter(item => {
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
      return true;
    });

    if (filtered.length === 0) return [];

    // Items with no finished_at (mainly "planning"/pending entries the user
    // hasn't touched yet) have nothing of their own to sort by — fall back to
    // the work's release date instead of lumping them all together unordered.
    const releaseTimestamp = (i: Items[number]): number => {
      const meta = catalogMap.get(i.external_id);
      if (!meta?.release_year) return 0;
      return new Date(meta.release_year, (meta.release_month ?? 1) - 1, meta.release_day ?? 1).getTime();
    };

    const sortItems = (itemList: Items) => [...itemList].sort((a, b) => {
      if (sortBy === 'rating') return (b.rating ?? 0) - (a.rating ?? 0);
      if (sortBy === 'duration') return getItemMinutes(b, catalogMap) - getItemMinutes(a, catalogMap);
      const dateA = a.finished_at ? new Date(a.finished_at).getTime() : releaseTimestamp(a);
      const dateB = b.finished_at ? new Date(b.finished_at).getTime() : releaseTimestamp(b);
      if (dateA === 0 && dateB !== 0) return 1;
      if (dateB === 0 && dateA !== 0) return -1;
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
      return dateB - dateA; // newest finished/released to oldest
    });

    // "Al día" is a computed regrouping, not a stored status (see isCaughtUpOnReleasing).
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
      // Edition/saga-chain grouping is gated behind "Agrupar por entrega"; bundle grouping has its own toggle.
      .map(sec => {
        const editionGroups = groupEditions(sec.items, catalogMap, groupByEdition);
        let cards: Array<{ item: Items[number]; grouped: Items[number][]; bundleMeta?: MediaCatalogEntry; titleOverride?: string; aggregateStats?: boolean }> = editionGroups;
        if (groupByBundle) {
          cards = groupBundles(cards, catalogMap, sagaRelations);
        }
        if (groupByEdition) {
          cards = refineSagaGroups(cards, catalogMap, sagaRelations, sagaNames);
        }

        // groupBundles/refineSagaGroups append merged cards regardless of date/rating — re-sort using the group's aggregate.
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
  }, [items, catalogMap, sagaRelations, sagaComponentOf, sagaNames, nameFilter, activeTypeTab, selectedEditionFormats, statusIndex, sortBy, groupByEdition, groupByBundle, STATUS_LIST, p]);

  const presentTypes = useMemo(() => {
    if (!items) return [];
    const present = new Set(items.map(i => i.type));
    return ALL_MEDIA_TYPES.filter(t => present.has(t));
  }, [items]);

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
    <div className="library-layout entering">
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
            {EDITION_FILTER_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                className={`library-edition-btn ${selectedEditionFormats.includes(opt.key) ? 'active' : ''}`}
                onClick={() => setSelectedEditionFormats(prev =>
                  prev.includes(opt.key) ? prev.filter(k => k !== opt.key) : [...prev, opt.key]
                )}
              >
                {(getT().media?.formats as Record<string, string>)?.[opt.key] || opt.label}
              </button>
            ))}
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
                <span dangerouslySetInnerHTML={{ __html: TYPE_ICON[type] }} />
                {typeLabels[type as keyof typeof typeLabels] || getTypeLabel(type)}
              </button>
            ))}
          </div>
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
                    readOnly={readOnly}
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
