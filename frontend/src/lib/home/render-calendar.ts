import { getAllLibraryEntries, getAllCatalogEntries } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { getT } from '../../i18n/client';
import { TYPE_LABELS } from '../constants/media';
import {
  computeUpcomingPlanningReleases,
  computeCalendarMonth,
  type UpcomingRelease,
  type CalendarDay,
} from '../profile/stats-calculators';
import { fetchGeneralUpcomingReleases } from './upcoming-general';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;
type CalendarMode = 'mine' | 'general';

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;');
}

function releaseThumbHtml(r: UpcomingRelease): string {
  return r.cover
    ? `<img class="calendar-popover-cover" src="${r.cover}" alt="" loading="lazy" />`
    : `<div class="calendar-popover-cover calendar-popover-cover--empty"></div>`;
}

const POPOVER_PAGE_SIZE = 8; // 4 columns × 2 rows

function popoverItemHtml(r: UpcomingRelease): string {
  return `
    <a class="calendar-popover-item" href="/media?id=${encodeURIComponent(r.externalId)}" title="${escAttr(r.title)}">
      ${releaseThumbHtml(r)}
      <p class="calendar-popover-title">${r.title}</p>
      <p class="calendar-popover-meta">${TYPE_LABELS[r.type] || r.type}</p>
    </a>
  `;
}

// Rebuildable body (pages + pager) for a given (already-filtered) release
// list — shared by the initial render and by the popover's own type-tab
// click handler, which re-slices the day's full list without re-fetching.
function popoverBodyHtml(releases: UpcomingRelease[]): string {
  if (releases.length === 0) {
    return `<p class="stats-calendar-empty" style="padding: 0.75rem 0;">Nada de este tipo este día.</p>`;
  }

  const pages: UpcomingRelease[][] = [];
  for (let i = 0; i < releases.length; i += POPOVER_PAGE_SIZE) {
    pages.push(releases.slice(i, i + POPOVER_PAGE_SIZE));
  }

  const pagesHtml = pages.map((pageReleases, idx) => `
    <div class="calendar-popover-page ${idx === 0 ? 'active' : ''}">
      ${pageReleases.map(popoverItemHtml).join('')}
    </div>
  `).join('');

  const pagerHtml = pages.length > 1 ? `
    <div class="calendar-popover-pager">
      <button type="button" class="calendar-popover-pager-btn" data-dir="-1" disabled>‹</button>
      <span class="calendar-popover-pager-label">1 / ${pages.length}</span>
      <button type="button" class="calendar-popover-pager-btn" data-dir="1">›</button>
    </div>
  ` : '';

  return pagesHtml + pagerHtml;
}

// Shared by both the page-level "Para ti"/"General" tab row and each day
// popover's own per-day filter — same "Todos" + one button per medium
// present shape, just a different active state source and CSS class.
function buildTypeTabsHtml(releases: UpcomingRelease[], activeType: string | null, tabClass: string): string {
  const present = new Set(releases.map(r => r.type));
  // Keep TYPE_LABELS' order rather than first-seen order, so tabs don't
  // jump around as the underlying release list changes.
  const orderedTypes = Object.keys(TYPE_LABELS).filter(ty => present.has(ty));
  if (orderedTypes.length < 2) return '';

  return `
    <button type="button" class="${tabClass} ${!activeType ? 'active' : ''}" data-type="">Todos</button>
    ${orderedTypes.map(ty => `
      <button type="button" class="${tabClass} ${activeType === ty ? 'active' : ''}" data-type="${ty}">${TYPE_LABELS[ty] || ty}</button>
    `).join('')}
  `;
}

// Each release is a link straight to its media page — clicking a cover
// navigates there. Laid out as a 4-column grid (see .calendar-day-popover),
// so this stays a vertical card (cover on top, title below) rather than the
// horizontal row it used to be as a single-column list. Beyond 2 rows
// (8 releases) the rest are paginated instead of growing the popover
// indefinitely. A per-day type filter sits above the grid when the day
// mixes more than one medium — re-filtering looks the day's releases back
// up from dayReleasesByDay (keyed by day-of-month) rather than serializing
// them through the DOM.
function dayPopoverHtml(releases: UpcomingRelease[]): string {
  if (releases.length === 0) return '';

  return `
    <div class="calendar-day-popover">
      ${buildTypeTabsHtml(releases, null, 'calendar-popover-type-tab')}
      <div class="calendar-popover-body">
        ${popoverBodyHtml(releases)}
      </div>
    </div>
  `;
}

function buildCalendarGridHtml(calendarDays: CalendarDay[], startOffset: number): string {
  const dayHeaders = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const calendarHeaderHtml = dayHeaders.map(h => `<div class="calendar-day-header">${h}</div>`).join('');

  const calendarCells: string[] = [];
  for (let i = 0; i < startOffset; i++) {
    calendarCells.push(`<div class="calendar-day other-month"></div>`);
  }
  for (const { day, isToday, releases: dayReleases } of calendarDays) {
    const hasReleases = dayReleases.length > 0;
    let cellStyle = '';
    let hasCoverClass = '';
    let dotHtml = '';
    if (hasReleases) {
      const firstRelease = dayReleases[0];
      if (firstRelease.cover) {
        cellStyle = `background-image: url('${firstRelease.cover}');`;
        hasCoverClass = 'has-cover';
      } else {
        dotHtml = `<div class="calendar-day-event-dot"></div>`;
      }
    }

    calendarCells.push(`
      <div class="calendar-day ${isToday ? 'today' : ''} ${hasCoverClass} ${hasReleases ? 'has-releases' : ''}" data-day="${day}" style="${cellStyle}">
        <span class="calendar-day-num">${day}</span>
        ${dotHtml}
        ${dayPopoverHtml(dayReleases)}
      </div>
    `);
  }

  return `
    <div class="calendar-grid">
      ${calendarHeaderHtml}
      ${calendarCells.join('')}
    </div>
  `;
}

// Moved here from the profile Stats tab — the release calendar reads the
// same library/catalog data but doesn't belong behind the profile page, so
// it now renders straight on Home instead. Two modes: "mine" (the user's own
// planning-status library items — the original behavior) and "general"
// (every upcoming release this month across AniList/TMDB/IGDB, fetched
// lazily and cached once per page load).
export async function renderReleaseCalendar(el: HTMLElement): Promise<void> {
  const t = getT();
  const p = t.profile;

  const [items, catalogEntries] = await Promise.all([
    getAllLibraryEntries().catch(() => [] as Items),
    getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
  ]);
  const catalogMap = new Map<string, MediaCatalogEntry>(
    catalogEntries.map(e => [e.external_id, e])
  );

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const currentMonthName = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  // Covers the whole current month, not just today onward — a release
  // calendar should show what already came out earlier this month too.
  const startOfMonth = new Date(currentYear, currentMonth, 1);
  const endOfMonth = new Date(currentYear, currentMonth + 1, 0);

  // Cheap and synchronous (just filters data already in memory) — computed
  // once up front, unlike generalReleases below which is worth lazily
  // fetching/caching since it's a real network round-trip.
  const mineReleases = computeUpcomingPlanningReleases(items, catalogMap, startOfMonth);
  let generalReleases: UpcomingRelease[] | null = null;

  async function getGeneralReleases(): Promise<UpcomingRelease[]> {
    if (!generalReleases) generalReleases = await fetchGeneralUpcomingReleases(startOfMonth, endOfMonth);
    return generalReleases;
  }

  let mode: CalendarMode = 'mine';
  let typeFilter: string | null = null; // null = "Todos" (mixed)
  // Keyed by day-of-month for the currently-rendered grid, so the popover's
  // per-day type filter can look a day's full release list back up instead
  // of round-tripping it through a JSON-encoded DOM attribute.
  let dayReleasesByDay = new Map<number, UpcomingRelease[]>();

  async function renderAll(gridEl: HTMLElement, tabsEl: HTMLElement) {
    gridEl.innerHTML = `<p class="stats-calendar-empty">Cargando...</p>`;
    const releases = mode === 'mine' ? mineReleases : await getGeneralReleases();
    tabsEl.innerHTML = buildTypeTabsHtml(releases, typeFilter, 'home-calendar-type-tab');

    const filtered = typeFilter ? releases.filter(r => r.type === typeFilter) : releases;
    const { days: calendarDays, startOffset } = computeCalendarMonth(filtered, now, currentYear, currentMonth);
    dayReleasesByDay = new Map(calendarDays.map(d => [d.day, d.releases]));
    gridEl.innerHTML = buildCalendarGridHtml(calendarDays, startOffset);
  }

  el.innerHTML = `
    <div class="home-card">
      <div class="stats-calendar-header">
        <h3 class="home-card-title">${p.stats_calendar}</h3>
        <span class="stats-calendar-month">${currentMonthName}</span>
      </div>
      <div class="home-calendar-controls">
        <div class="home-calendar-toggle">
          <button type="button" class="home-calendar-toggle-btn active" data-mode="mine">Para ti</button>
          <button type="button" class="home-calendar-toggle-btn" data-mode="general">General</button>
        </div>
        <div class="home-calendar-type-tabs"></div>
      </div>
      <div class="home-calendar-grid-mount"></div>
    </div>
  `;

  const gridEl = el.querySelector<HTMLElement>('.home-calendar-grid-mount')!;
  const tabsEl = el.querySelector<HTMLElement>('.home-calendar-type-tabs')!;
  await renderAll(gridEl, tabsEl);

  el.querySelectorAll<HTMLButtonElement>('.home-calendar-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newMode = btn.dataset.mode as CalendarMode;
      if (newMode === mode) return;
      mode = newMode;
      typeFilter = null; // available types differ per mode — reset rather than keep a stale filter
      el.querySelectorAll('.home-calendar-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await renderAll(gridEl, tabsEl);
    });
  });

  tabsEl.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('.home-calendar-type-tab') as HTMLButtonElement | null;
    if (!btn) return;
    const newType = btn.dataset.type || null;
    if (newType === typeFilter) return;
    typeFilter = newType;
    await renderAll(gridEl, tabsEl);
  });

  // Click (not hover) opens a day's release popover — hover was lost the
  // moment the page scrolled since the cursor stops being over the cell,
  // which made the list disappear while trying to scroll up to read it.
  // Delegated on the document so it keeps working across grid re-renders
  // (mode switch) and also closes the popover on any outside click.
  function handleDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;

    const pagerBtn = target.closest('.calendar-popover-pager-btn') as HTMLButtonElement | null;
    if (pagerBtn) {
      const popover = pagerBtn.closest('.calendar-day-popover')!;
      const pages = Array.from(popover.querySelectorAll<HTMLElement>('.calendar-popover-page'));
      const activeIdx = pages.findIndex(pg => pg.classList.contains('active'));
      const nextIdx = Math.max(0, Math.min(pages.length - 1, activeIdx + Number(pagerBtn.dataset.dir)));
      if (nextIdx !== activeIdx) {
        pages[activeIdx]?.classList.remove('active');
        pages[nextIdx]?.classList.add('active');
      }
      const label = popover.querySelector('.calendar-popover-pager-label');
      if (label) label.textContent = `${nextIdx + 1} / ${pages.length}`;
      const [prevBtn, nextBtn] = popover.querySelectorAll<HTMLButtonElement>('.calendar-popover-pager-btn');
      prevBtn.disabled = nextIdx === 0;
      nextBtn.disabled = nextIdx === pages.length - 1;
      return; // don't also toggle the day cell open/closed
    }

    // Per-day type filter inside the popover — re-slices that day's own
    // full release list without touching the outer "Para ti"/"General"
    // fetch or the main calendar-wide filter.
    const typeTab = target.closest('.calendar-popover-type-tab') as HTMLButtonElement | null;
    if (typeTab) {
      const dayCell = typeTab.closest('.calendar-day') as HTMLElement;
      const dayReleases = dayReleasesByDay.get(Number(dayCell.dataset.day)) ?? [];
      const selectedType = typeTab.dataset.type || null;
      const filtered = selectedType ? dayReleases.filter(r => r.type === selectedType) : dayReleases;

      const popover = typeTab.closest('.calendar-day-popover')!;
      popover.querySelectorAll('.calendar-popover-type-tab').forEach(b => b.classList.remove('active'));
      typeTab.classList.add('active');

      const body = popover.querySelector('.calendar-popover-body')!;
      body.innerHTML = popoverBodyHtml(filtered);
      return;
    }

    // A release link inside the popover: let it navigate, don't re-toggle
    // the day cell it happens to be nested in.
    if (target.closest('.calendar-popover-item')) return;

    const dayCell = target.closest('.calendar-day.has-releases') as HTMLElement | null;
    const openDays = gridEl.querySelectorAll('.calendar-day.open');
    if (dayCell) {
      const wasOpen = dayCell.classList.contains('open');
      openDays.forEach(d => d.classList.remove('open'));
      if (!wasOpen) dayCell.classList.add('open');
    } else {
      openDays.forEach(d => d.classList.remove('open'));
    }
  }
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('astro:before-swap', () => document.removeEventListener('click', handleDocumentClick), { once: true });
}
