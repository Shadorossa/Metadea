import { useEffect, useMemo, useRef, useState } from 'react';
import { getAllLibraryEntries, getAllCatalogEntries, wrapAssetUrl } from '../../lib/tauri';
import type { MediaCatalogEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { TYPE_LABELS, getTypeLabel } from '../../lib/constants/media';
import {
  computeUpcomingPlanningReleases,
  computeCalendarMonth,
  type UpcomingRelease,
  type CalendarDay,
} from '../../lib/profile/stats-calculators';
import { fetchGeneralUpcomingReleases } from '../../lib/home/upcoming-general';
import { formatMonthYear } from '../../lib/shared/formatDate';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type CalendarMode = 'mine' | 'general';

const POPOVER_PAGE_SIZE = 8; // 4 columns × 2 rows

function TypeTabs({ releases, activeType, tabClass, onSelect }: {
  releases: UpcomingRelease[];
  activeType: string | null;
  tabClass: string;
  onSelect: (type: string | null) => void;
}) {
  const present = new Set(releases.map(r => r.type));
  // Keeps TYPE_LABELS' order rather than first-seen order, so tabs don't
  // jump around as the underlying release list changes.
  const orderedTypes = Object.keys(TYPE_LABELS).filter(ty => present.has(ty));
  if (orderedTypes.length < 2) return null;

  const p = getT().profile;

  return (
    <>
      <button type="button" className={`${tabClass} ${!activeType ? 'active' : ''}`} onClick={() => onSelect(null)}>{p.calendar_all_types}</button>
      {orderedTypes.map(ty => (
        <button key={ty} type="button" className={`${tabClass} ${activeType === ty ? 'active' : ''}`} onClick={() => onSelect(ty)}>
          {getTypeLabel(ty)}
        </button>
      ))}
    </>
  );
}

function ReleaseThumb({ release }: { release: UpcomingRelease }) {
  return release.cover
    ? <img className="calendar-popover-cover" src={wrapAssetUrl(release.cover)} alt="" loading="lazy" />
    : <div className="calendar-popover-cover calendar-popover-cover--empty" />;
}

function DayPopover({ releases }: { releases: UpcomingRelease[] }) {
  const p = getT().profile;
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const filtered = typeFilter ? releases.filter(r => r.type === typeFilter) : releases;
  const pages: UpcomingRelease[][] = [];
  for (let i = 0; i < filtered.length; i += POPOVER_PAGE_SIZE) {
    pages.push(filtered.slice(i, i + POPOVER_PAGE_SIZE));
  }
  const clampedPage = Math.min(page, Math.max(0, pages.length - 1));

  return (
    <div className="calendar-day-popover">
      <div className="calendar-popover-body" onClick={e => e.stopPropagation()}>
        <div className="calendar-popover-type-tabs">
          <TypeTabs
            releases={releases}
            activeType={typeFilter}
            tabClass="calendar-popover-type-tab"
            onSelect={t => { setTypeFilter(t); setPage(0); }}
          />
        </div>
        {filtered.length === 0 ? (
          <p className="stats-calendar-empty" style={{ padding: '0.75rem 0' }}>{p.calendar_no_releases_type}</p>
        ) : (
          <>
            <div className="calendar-popover-page active">
              {pages[clampedPage]?.map(r => (
                <a key={r.externalId} className="calendar-popover-item" href={`/media?id=${encodeURIComponent(r.externalId)}`} title={r.title}>
                  <ReleaseThumb release={r} />
                  <p className="calendar-popover-title">{r.title}</p>
                  <p className="calendar-popover-meta">{getTypeLabel(r.type)}</p>
                </a>
              ))}
            </div>
            {pages.length > 1 && (
              <div className="calendar-popover-pager">
                <button type="button" className="calendar-popover-pager-btn" disabled={clampedPage === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>‹</button>
                <span className="calendar-popover-pager-label">{clampedPage + 1} / {pages.length}</span>
                <button type="button" className="calendar-popover-pager-btn" disabled={clampedPage === pages.length - 1} onClick={() => setPage(p => Math.min(pages.length - 1, p + 1))}>›</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function CalendarSection() {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => { setIsMounted(true); }, []);

  const t = getT();
  const p = isMounted ? t.profile : (getT().profile || t.profile);

  const now = useMemo(() => new Date(), []);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const currentMonthName = formatMonthYear(now);
  // Covers the whole current month, not just today onward — a release
  // calendar should show what already came out earlier this month too.
  const startOfMonth = useMemo(() => new Date(currentYear, currentMonth, 1), [currentYear, currentMonth]);
  const endOfMonth = useMemo(() => new Date(currentYear, currentMonth + 1, 0), [currentYear, currentMonth]);

  const [mode, setMode] = useState<CalendarMode>('mine');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const [mineReleases, setMineReleases] = useState<UpcomingRelease[]>([]);
  const [generalReleases, setGeneralReleases] = useState<UpcomingRelease[] | null>(null);
  const [generalLoading, setGeneralLoading] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [items, catalogEntries] = await Promise.all([
        getAllLibraryEntries().catch(() => [] as Items),
        getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
      ]);
      if (cancelled) return;
      const catalogMap = new Map<string, MediaCatalogEntry>(catalogEntries.map(e => [e.external_id, e]));
      setMineReleases(computeUpcomingPlanningReleases(items, catalogMap, startOfMonth));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [startOfMonth]);

  useEffect(() => {
    if (mode !== 'general' || generalReleases !== null) return;
    let cancelled = false;
    setGeneralLoading(true);
    fetchGeneralUpcomingReleases(startOfMonth, endOfMonth).then(res => {
      if (!cancelled) { setGeneralReleases(res); setGeneralLoading(false); }
    });
    return () => { cancelled = true; };
  }, [mode, generalReleases, startOfMonth, endOfMonth]);

  // Click outside any day cell closes whichever popover is open — delegated
  // on the document (not each cell) so it also catches clicks on other
  // cells, closing the previous popover before the new one's own handler
  // opens the next.
  useEffect(() => {
    if (openDay === null) return;
    const close = (e: MouseEvent) => {
      if (gridRef.current?.contains(e.target as Node)) return;
      setOpenDay(null);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [openDay]);

  const releases = mode === 'mine' ? mineReleases : (generalReleases ?? []);
  const filtered = typeFilter ? releases.filter(r => r.type === typeFilter) : releases;
  const { days: calendarDays, startOffset } = useMemo(
    () => computeCalendarMonth(filtered, now, currentYear, currentMonth),
    [filtered, now, currentYear, currentMonth]
  );

  const isBusy = mode === 'mine' ? loading : generalLoading;

  const dayHeaders = p.calendar_days || ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  return (
    <div className="home-card">
      <div className="stats-calendar-header">
        <h3 className="home-card-title">{p.stats_calendar}</h3>
        <span className="stats-calendar-month">{currentMonthName}</span>
      </div>
      <div className="home-calendar-controls">
        <div className="home-calendar-toggle">
          <button
            type="button"
            className={`home-calendar-toggle-btn ${mode === 'mine' ? 'active' : ''}`}
            onClick={() => { setMode('mine'); setTypeFilter(null); }}
          >
            {p.calendar_for_you}
          </button>
          <button
            type="button"
            className={`home-calendar-toggle-btn ${mode === 'general' ? 'active' : ''}`}
            onClick={() => { setMode('general'); setTypeFilter(null); }}
          >
            {p.calendar_general}
          </button>
        </div>
        <div className="home-calendar-type-tabs">
          <TypeTabs releases={releases} activeType={typeFilter} tabClass="home-calendar-type-tab" onSelect={setTypeFilter} />
        </div>
      </div>
      <div className="home-calendar-grid-mount">
        {isBusy ? (
          <p className="stats-calendar-empty">{getT().character.loading}</p>
        ) : (
          <div className="calendar-grid" ref={gridRef}>
            {dayHeaders.map(h => <div className="calendar-day-header" key={h}>{h}</div>)}
            {Array.from({ length: startOffset }).map((_, i) => <div className="calendar-day other-month" key={`pad-${i}`} />)}
            {calendarDays.map(({ day, isToday, releases: dayReleases }: CalendarDay) => {
              const hasReleases = dayReleases.length > 0;
              const firstRelease = hasReleases ? dayReleases[0] : null;
              const hasCover = Boolean(firstRelease?.cover);
              const isOpen = openDay === day;

              return (
                <div
                  key={day}
                  className={`calendar-day ${isToday ? 'today' : ''} ${hasCover ? 'has-cover' : ''} ${hasReleases ? 'has-releases' : ''} ${isOpen ? 'open' : ''}`}
                  onClick={() => { if (hasReleases) setOpenDay(isOpen ? null : day); }}
                >
                  {hasCover && (
                    // A real <img>, not a CSS background-image — background-image
                    // set via inline style silently failed to render in the
                    // packaged production build (same root cause fixed for the
                    // Hall of Fame cards), while <img> elements always rendered fine.
                    <img className="calendar-day-cover" src={wrapAssetUrl(firstRelease!.cover)} alt="" />
                  )}
                  <span className="calendar-day-num">{day}</span>
                  {hasReleases && !hasCover && <div className="calendar-day-event-dot" />}
                  {isOpen && hasReleases && <DayPopover releases={dayReleases} />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
