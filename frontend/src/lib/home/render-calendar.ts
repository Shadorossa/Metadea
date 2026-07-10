import { getAllLibraryEntries, getAllCatalogEntries } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { getT } from '../../i18n/client';
import { TYPE_LABELS } from '../constants/media';
import {
  computeUpcomingPlanningReleases,
  computeCalendarMonth,
  type UpcomingRelease,
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

// Each release is a link straight to its media page — clicking a cover
// navigates there. Laid out as a 4-column grid (see .calendar-day-popover),
// so this stays a vertical card (cover on top, title below) rather than the
// horizontal row it used to be as a single-column list.
function dayPopoverHtml(releases: UpcomingRelease[]): string {
  if (releases.length === 0) return '';
  return `
    <div class="calendar-day-popover" onclick="event.stopPropagation()">
      ${releases.map(r => `
        <a class="calendar-popover-item" href="/media?id=${encodeURIComponent(r.externalId)}" title="${escAttr(r.title)}">
          ${releaseThumbHtml(r)}
          <p class="calendar-popover-title">${r.title}</p>
          <p class="calendar-popover-meta">${TYPE_LABELS[r.type] || r.type}</p>
        </a>
      `).join('')}
    </div>
  `;
}

function buildCalendarGridHtml(releases: UpcomingRelease[], now: Date, currentYear: number, currentMonth: number): string {
  const { days: calendarDays, startOffset } = computeCalendarMonth(releases, now, currentYear, currentMonth);

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
  const todayDate = new Date(currentYear, currentMonth, now.getDate());
  const endOfMonth = new Date(currentYear, currentMonth + 1, 0);

  let mode: CalendarMode = 'mine';
  let mineReleases: UpcomingRelease[] | null = null;
  let generalReleases: UpcomingRelease[] | null = null;

  function getMineReleases(): UpcomingRelease[] {
    if (!mineReleases) mineReleases = computeUpcomingPlanningReleases(items, catalogMap, todayDate);
    return mineReleases;
  }

  async function getGeneralReleases(): Promise<UpcomingRelease[]> {
    if (!generalReleases) generalReleases = await fetchGeneralUpcomingReleases(todayDate, endOfMonth);
    return generalReleases;
  }

  async function renderGrid(gridEl: HTMLElement) {
    gridEl.innerHTML = `<p class="stats-calendar-empty">Cargando...</p>`;
    const releases = mode === 'mine' ? getMineReleases() : await getGeneralReleases();
    gridEl.innerHTML = buildCalendarGridHtml(releases, now, currentYear, currentMonth);
  }

  el.innerHTML = `
    <div class="home-card">
      <div class="stats-calendar-header">
        <h3 class="home-card-title">${p.stats_calendar}</h3>
        <span class="stats-calendar-month">${currentMonthName}</span>
      </div>
      <div class="home-calendar-toggle">
        <button type="button" class="home-calendar-toggle-btn active" data-mode="mine">Para ti</button>
        <button type="button" class="home-calendar-toggle-btn" data-mode="general">General</button>
      </div>
      <div class="home-calendar-grid-mount"></div>
    </div>
  `;

  const gridEl = el.querySelector<HTMLElement>('.home-calendar-grid-mount')!;
  await renderGrid(gridEl);

  el.querySelectorAll<HTMLButtonElement>('.home-calendar-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newMode = btn.dataset.mode as CalendarMode;
      if (newMode === mode) return;
      mode = newMode;
      el.querySelectorAll('.home-calendar-toggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await renderGrid(gridEl);
    });
  });

  // Click (not hover) opens a day's release popover — hover was lost the
  // moment the page scrolled since the cursor stops being over the cell,
  // which made the list disappear while trying to scroll up to read it.
  // Delegated on the document so it keeps working across grid re-renders
  // (mode switch) and also closes the popover on any outside click. Clicks
  // inside an open popover (dayPopoverHtml's stopPropagation) never reach
  // here at all — that's what lets a cover's <a> navigate normally instead
  // of being treated as "click the day cell again to close it".
  function handleDocumentClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
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
