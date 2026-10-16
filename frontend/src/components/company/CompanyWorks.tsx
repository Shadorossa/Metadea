import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Eye } from 'lucide-react';
import type { Translations } from '../../i18n/index';
import { getLangCode } from '../../i18n/runtime';
import type { CompanyWork } from '../../lib/tauri/company-catalog';
import {
  companyInitials,
  filterAndSortWorks,
  hasExtras,
  hasRoleSplit,
  type CompanyRoleFilter,
  type CompanyWorkFilters,
  type CompanyWorkSort,
} from '../../lib/company/company-works';
import { workLibraryState, workProgressRatio, type WorkLibraryState } from '../../lib/media/creator-completion';
import { toMediumCover } from '../../lib/media/small-cover';
import { attributeUrl } from '../../lib/character/character-page-urls';
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
}

// Cards rendered per step of the infinite scroll.
const PAGE_SIZE = 48;

function formatReleaseDate(work: CompanyWork): string | null {
  if (work.release_date) {
    const date = new Date(work.release_date + 'T00:00:00Z');
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(getLangCode(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(date);
    }
  }
  return work.year == null ? null : String(work.year);
}

function seasonTitle(work: CompanyWork, parentTitle: string): string {
  const prefix = work.title.slice(0, parentTitle.length);
  if (prefix.toLocaleLowerCase() !== parentTitle.toLocaleLowerCase()) return work.title;
  const remainder = work.title.slice(parentTitle.length).replace(/^\s*[:\-–—]\s*/, '');
  return remainder || work.title;
}

function splitSeasonName(title: string): { name: string; label: string | null } {
  const match = /^season\s+(\d+)\s*(?:[-–—:]\s*(.+))?$/i.exec(title.trim());
  if (!match) return { name: title, label: null };
  return { name: match[2]?.trim() ?? '', label: `Season ${match[1]}` };
}

function WorkCard({ work, state, progress, t, tc }: {
  work: CompanyWork;
  state: WorkLibraryState | null;
  progress: number | null;
  t: Translations['company_page'];
  tc: Translations['creator_completion'];
}) {
  const cover = attributeUrl(toMediumCover(work.cover_url));
  const releaseDate = formatReleaseDate(work);
  const titlePrefix = work.title.split(':', 1)[0].trim();
  const inferredParentTitle = titlePrefix.length < work.title.length ? titlePrefix : null;
  const isSeason = work.format?.toUpperCase() === 'SEASON' || /:\s*season\b/i.test(work.title);
  const seasonParentTitle = isSeason
    ? work.parent_title || inferredParentTitle
    : null;
  const seasonName = seasonParentTitle ? seasonTitle(work, seasonParentTitle) : work.title;
  const { name: seasonDisplayName, label: seasonLabel } = seasonParentTitle
    ? splitSeasonName(seasonName)
    : { name: seasonName, label: null };
  const accessibleTitle = [seasonParentTitle, seasonDisplayName, seasonLabel].filter(Boolean).join(' ') || work.title;
  return (
    <a
      href={`/media?id=${work.external_id}`}
      className={`company-work-card${creatorWorkClass(state)}`}
      aria-label={accessibleTitle}
    >
      <div className="company-work-cover">
        {cover
          ? <img src={cover} alt="" loading="lazy" />
          : <span className="company-work-cover-placeholder" aria-hidden="true">{companyInitials(work.title)}</span>}
        {(work.unreleased || work.is_extra) && (
          <span className={`company-work-flag${work.is_extra && !work.unreleased ? ' company-work-flag--extra' : ''}`}>
            {work.unreleased ? t.unreleased : t.extra}
          </span>
        )}
        <CreatorWorkState state={state} progress={progress} strings={tc} />
        <span className="company-work-title-overlay" aria-hidden="true">
          {seasonParentTitle ? (
            <>
              <span className="company-work-title-parent">{seasonParentTitle}</span>
              {seasonDisplayName && <span>{seasonDisplayName}</span>}
              {seasonLabel && <span className="company-work-season-label">{seasonLabel}</span>}
            </>
          ) : work.title}
        </span>
      </div>
      {releaseDate && <span className="company-work-meta">{releaseDate}</span>}
    </a>
  );
}

export function CompanyWorks({ works, filters, onFiltersChange, snapshot, loadingMore, t, tc }: Props) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [view, setView] = useCreatorWorksView('company');
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const shown = useMemo(() => {
    const stateOf = (id: string): WorkLibraryState => (snapshot ? workLibraryState(snapshot.libraryById.get(id)) : 'missing');
    return filterAndSortWorks(works, filters, stateOf);
  }, [works, filters, snapshot]);
  const showRoleFilter = useMemo(() => hasRoleSplit(works), [works]);
  const showExtrasToggle = useMemo(() => hasExtras(works), [works]);

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
    <section className="company-works" aria-label={t.works}>
      <div className="media-section-header-row company-works-header">
        <div className="company-filters">
          <button
            type="button"
            className={`company-filter-toggle${filters.onlyMissing ? ' active' : ''}`}
            aria-label={t.only_missing}
            aria-pressed={filters.onlyMissing}
            title={t.only_missing}
            onClick={() => update({ onlyMissing: !filters.onlyMissing })}
          >
            <Eye size={16} aria-hidden="true" />
          </button>
          {showExtrasToggle && (
            <button
              type="button"
              className={`company-filter-toggle${filters.includeExtras ? ' active' : ''}`}
              aria-label={t.include_extras}
              aria-pressed={filters.includeExtras}
              title={t.include_extras}
              onClick={() => update({ includeExtras: !filters.includeExtras })}
            >
              <Boxes size={16} aria-hidden="true" />
            </button>
          )}
        </div>
        <div className="media-section-header-line"></div>
        {(showRoleFilter || view === 'grid') && (
          <div className="company-header-controls">
            {showRoleFilter && (
              <label className="company-sort-control">
                <span>{t.filter_role}</span>
                <select
                  className="company-sort-select"
                  value={filters.role}
                  onChange={e => update({ role: e.target.value as CompanyRoleFilter })}
                >
                  <option value="all">{t.role_all}</option>
                  <option value="developed">{t.role_developed}</option>
                  <option value="published">{t.role_published}</option>
                </select>
              </label>
            )}
            {view === 'grid' && (
              <label className="company-sort-control">
                <span>{t.sort}</span>
                <select
                  className="company-sort-select"
                  value={filters.sort}
                  onChange={e => update({ sort: e.target.value as CompanyWorkSort })}
                >
                  <option value="year">{t.sort_year}</option>
                  <option value="title">{t.sort_title}</option>
                  <option value="status">{t.sort_status}</option>
                </select>
              </label>
            )}
          </div>
        )}
        <CreatorViewSwitch view={view} onChange={setView} strings={tc} />
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
