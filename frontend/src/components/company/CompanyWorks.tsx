import { useEffect, useMemo, useRef, useState } from 'react';
import type { Translations } from '../../i18n/index';
import type { CompanyWork } from '../../lib/tauri/company-catalog';
import {
  availableTypes,
  companyInitials,
  filterAndSortWorks,
  hasExtras,
  hasMasterpieces,
  hasRoleSplit,
  type CompanyRoleFilter,
  type CompanyWorkFilters,
  type CompanyWorkSort,
} from '../../lib/company/company-works';
import { workLibraryState, workProgressRatio, type WorkLibraryState } from '../../lib/media/creator-completion';
import { toMediumCover } from '../../lib/media/small-cover';
import { attributeUrl } from '../../lib/character/character-page-urls';
import { interpolate } from '../../lib/shared/text/interpolate';
import { CreatorWorkState, creatorWorkClass } from '../shared/CreatorWorkState';
import { CareerTimeline, type CareerTimelineItem } from '../shared/CareerTimeline';
import { useTimelineYears } from '../shared/hooks/useTimelineYears';
import { CreatorViewSwitch, useCreatorWorksView } from '../shared/CreatorViewSwitch';
import type { LibrarySnapshot } from '../shared/hooks/useLibrarySnapshot';

interface Props {
  works: CompanyWork[];
  filters: CompanyWorkFilters;
  onFiltersChange: (next: CompanyWorkFilters) => void;
  snapshot: LibrarySnapshot | null;
  loadingMore: boolean;
  t: Translations['company_page'];
  tc: Translations['creator_completion'];
  types: Translations['search']['types'];
}

// Cards rendered per step of the infinite scroll.
const PAGE_SIZE = 48;

function WorkCard({ work, state, progress, t, tc, typeLabel }: {
  work: CompanyWork;
  state: WorkLibraryState | null;
  progress: number | null;
  t: Translations['company_page'];
  tc: Translations['creator_completion'];
  typeLabel: string;
}) {
  const cover = attributeUrl(toMediumCover(work.cover_url));
  return (
    <a href={`/media?id=${work.external_id}`} className={`company-work-card${creatorWorkClass(state)}`}>
      <div className="company-work-cover">
        {cover
          ? <img src={cover} alt="" loading="lazy" />
          : <span className="company-work-cover-placeholder" aria-hidden="true">{companyInitials(work.title)}</span>}
        {(work.unreleased || work.is_extra) && (
          <span className="company-work-flag">{work.unreleased ? t.unreleased : t.extra}</span>
        )}
        <CreatorWorkState state={state} progress={progress} strings={tc} />
      </div>
      <span className="company-work-title">{work.title}</span>
      <span className="company-work-meta">{[work.year, typeLabel].filter(Boolean).join(' · ')}</span>
    </a>
  );
}

export function CompanyWorks({ works, filters, onFiltersChange, snapshot, loadingMore, t, tc, types }: Props) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [view, setView] = useCreatorWorksView('company');
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const typeLabels = types as Record<string, string>;

  const shown = useMemo(() => {
    const stateOf = (id: string): WorkLibraryState => (snapshot ? workLibraryState(snapshot.libraryById.get(id)) : 'missing');
    return filterAndSortWorks(works, filters, stateOf);
  }, [works, filters, snapshot]);
  const typeOptions = useMemo(() => availableTypes(works), [works]);
  const showRoleFilter = useMemo(() => hasRoleSplit(works), [works]);
  const showExtrasToggle = useMemo(() => hasExtras(works), [works]);
  const showMasterpieceToggle = useMemo(() => hasMasterpieces(works), [works]);

  const stateAndProgress = (id: string) => {
    const row = snapshot?.libraryById.get(id);
    const state = snapshot ? workLibraryState(row) : null;
    const progress = state === 'in_progress' ? workProgressRatio(row, snapshot?.catalogById.get(id)?.total_count) : null;
    return { state, progress };
  };

  // Both views stay mounted in one stacked cell (the inactive one hidden),
  // so switching never changes the section's size.
  const timelineItems = useMemo<CareerTimelineItem[]>(() => shown.map(work => {
    const row = snapshot?.libraryById.get(work.external_id);
    const state = snapshot ? workLibraryState(row) : null;
    return {
      id: work.external_id,
      href: `/media?id=${work.external_id}`,
      title: work.title,
      year: work.year,
      cover: attributeUrl(toMediumCover(work.cover_url)) || null,
      score: work.score,
      state,
      progress: state === 'in_progress' ? workProgressRatio(row, snapshot?.catalogById.get(work.external_id)?.total_count) : null,
      flag: work.unreleased ? t.unreleased : work.is_extra ? t.extra : null,
      unreleased: work.unreleased,
    };
  }), [shown, snapshot, t]);

  const update = (patch: Partial<CompanyWorkFilters>) => {
    setVisible(PAGE_SIZE);
    onFiltersChange({ ...filters, ...patch });
  };

  // Infinite scroll: reveal the next block when the sentinel nears view.
  useEffect(() => {
    const node = sentinelRef.current;
    if (view !== 'grid' || !node || visible >= shown.length) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) setVisible(v => v + PAGE_SIZE);
    }, { rootMargin: '600px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [view, visible, shown.length]);
  const datedTimelineItems = useTimelineYears(timelineItems);

  return (
    <section className="company-works" aria-labelledby="company-works-heading">
      <div className="media-section-header-row company-works-header">
        <p className="section-label" id="company-works-heading">
          {t.works} <span className="company-works-count">{interpolate(t.works_count, { count: shown.length })}</span>
        </p>
        <div className="media-section-header-line"></div>
        {(showRoleFilter || view === 'grid') && (
          <div className="company-header-controls">
            {showRoleFilter && (
              <select
                className="input-dark company-select company-select--compact"
                aria-label={t.filter_role}
                title={t.filter_role}
                value={filters.role}
                onChange={e => update({ role: e.target.value as CompanyRoleFilter })}
              >
                <option value="all">{t.role_all}</option>
                <option value="developed">{t.role_developed}</option>
                <option value="published">{t.role_published}</option>
              </select>
            )}
            {view === 'grid' && (
              <select
                className="input-dark company-select company-select--compact"
                aria-label={t.sort}
                title={t.sort}
                value={filters.sort}
                onChange={e => update({ sort: e.target.value as CompanyWorkSort })}
              >
                <option value="year">{t.sort_year}</option>
                <option value="title">{t.sort_title}</option>
                <option value="status">{t.sort_status}</option>
              </select>
            )}
          </div>
        )}
        <CreatorViewSwitch view={view} onChange={setView} strings={tc} />
      </div>

      <div className="company-filters">
        {typeOptions.length > 1 && (
          <label className="company-filter">
            <span>{t.filter_type}</span>
            <select className="input-dark company-select" value={filters.type} onChange={e => update({ type: e.target.value })}>
              <option value="all">{t.type_all}</option>
              {typeOptions.map(type => <option key={type} value={type}>{typeLabels[type] ?? type}</option>)}
            </select>
          </label>
        )}
        <label className="company-filter company-filter--check">
          <input type="checkbox" checked={filters.onlyMissing} onChange={e => update({ onlyMissing: e.target.checked })} />
          <span>{t.only_missing}</span>
        </label>
        {showExtrasToggle && (
          <label className="company-filter company-filter--check">
            <input type="checkbox" checked={filters.includeExtras} onChange={e => update({ includeExtras: e.target.checked })} />
            <span>{t.include_extras}</span>
          </label>
        )}
        {showMasterpieceToggle && (
          <label className="company-filter company-filter--check">
            <input type="checkbox" checked={filters.masterpiecesOnly} onChange={e => update({ masterpiecesOnly: e.target.checked })} />
            <span>{tc.masterpieces_only}</span>
          </label>
        )}
      </div>

      {shown.length === 0 && !loadingMore && (
        <p className="company-empty">{works.length === 0 ? t.no_works : t.empty_filtered}</p>
      )}

      <div className="creator-works-stack">
        <div className={`creator-works-pane${view === 'grid' ? '' : ' creator-works-pane--inactive'}`} inert={view !== 'grid'}>
            <div className="company-works-grid">
              {shown.slice(0, visible).map(work => {
                const { state, progress } = stateAndProgress(work.external_id);
                return (
                  <WorkCard
                    key={work.external_id}
                    work={work}
                    state={state}
                    progress={progress}
                    t={t}
                    tc={tc}
                    typeLabel={typeLabels[work.media_type] ?? work.media_type}
                  />
                );
              })}
            </div>
            <div ref={sentinelRef} className="company-works-sentinel" aria-hidden="true" />
        </div>
        <div className={`creator-works-pane${view === 'timeline' ? '' : ' creator-works-pane--inactive'}`} inert={view !== 'timeline'}>
          {shown.length > 0 && <CareerTimeline items={datedTimelineItems} strings={tc} />}
        </div>
      </div>
      {loadingMore && (
        <p className="company-loading-more" role="status"><span className="spinner company-spinner" aria-hidden="true" /> {t.loading_more}</p>
      )}
    </section>
  );
}
