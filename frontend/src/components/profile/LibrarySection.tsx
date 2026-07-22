import { useEffect, useMemo, useState } from 'react';
import { getAllLibraryEntries, getAllMediaRelations, getCatalogEntry, getSagaNames } from '../../lib/tauri';
import type { MediaCatalogEntry, DbMediaRelation } from '../../lib/tauri';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { notifyNewEpisode } from '../../lib/shared/notifications';
import { getT } from '../../i18n/client';
import { syncActiveRatingSystem } from '../../lib/media/rating-utils';
import { SORT_ICON_SCORE, SORT_ICON_DATE, SORT_ICON_DURATION, GROUP_EDITIONS_ICON } from '../../lib/shared/icon-strings';
import { TYPE_LABELS, isInProgressStatus } from '../../lib/constants/media';
import { getItemMinutes } from '../../lib/profile/stats-calculators';
import { needsResync, isCaughtUpOnReleasing } from '../../lib/media/media-status';
import { fetchMediaData } from '../../lib/media/mediaService';
import { groupEditions, groupBundles, refineSagaGroups, averageRating } from './library-grouping';
import { LibraryCard, TYPE_ICON } from './LibraryCard';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type SortBy = 'rating' | 'date' | 'duration';

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
      const [{ items: rawItems, catalog: catalogEntries }, relations] = await Promise.all([
        getCachedLibraryAndCatalog(),
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
        const before = catalogEntries.find(e => e.external_id === item.external_id);
        await fetchMediaData(item.external_id).catch(() => null);
        const fresh = await getCatalogEntry(item.external_id).catch(() => null);
        if (cancelled) return;
        if (fresh) {
          setCatalogMap(prev => new Map(prev).set(fresh.external_id, fresh));
          // total_count went up since the last known value — a new episode/
          // chapter aired for something the user is actively watching/reading.
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
