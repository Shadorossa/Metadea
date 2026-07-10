import { getAllLibraryEntries, getAllCatalogEntries } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { getT, getLangCode } from '../../i18n/client';
import { HOF_GRADIENTS } from '../profile/hof';
import { TYPE_LABELS } from '../constants/media';
import {
  computeUpcomingPlanningReleases,
  computeCalendarMonth,
  type UpcomingRelease,
} from '../profile/stats-calculators';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

function renderReleaseItemHtml(r: UpcomingRelease): string {
  const typeLabelText = TYPE_LABELS[r.type] || r.type;
  const fallbackBg = HOF_GRADIENTS[r.type] || 'linear-gradient(160deg, #374151, #1f2937)';
  const style = r.cover ? `background-image: url('${r.cover}'); background-size: cover;` : `background: ${fallbackBg};`;
  const dateLocale = getLangCode() === 'en' ? 'en-US' : 'es-ES';
  const formattedReleaseDate = r.releaseDate.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `
    <div class="calendar-release-item">
      <div class="calendar-release-img" style="${style}"></div>
      <div class="calendar-release-info">
        <p class="calendar-release-title">${r.title}</p>
        <p class="calendar-release-meta">${formattedReleaseDate} · ${typeLabelText}</p>
      </div>
    </div>
  `;
}

// Moved here from the profile Stats tab — the release calendar reads the
// same library/catalog data but doesn't belong behind the profile page, so
// it now renders straight on Home instead.
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
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // midnight today
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed
  const currentMonthName = now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  const upcomingPlanningReleases = computeUpcomingPlanningReleases(items, catalogMap, todayDate);
  const { days: calendarDays, startOffset } = computeCalendarMonth(upcomingPlanningReleases, now, currentYear, currentMonth);

  const dayHeaders = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const calendarHeaderHtml = dayHeaders.map(h => `<div class="calendar-day-header">${h}</div>`).join('');

  const calendarCells: string[] = [];
  for (let i = 0; i < startOffset; i++) {
    calendarCells.push(`<div class="calendar-day other-month"></div>`);
  }
  for (const { day, isToday, releases } of calendarDays) {
    const hasReleases = releases.length > 0;
    let cellStyle = '';
    let hasCoverClass = '';
    let dotHtml = '';
    let dayTooltip = '';
    if (hasReleases) {
      const firstRelease = releases[0];
      if (firstRelease.cover) {
        cellStyle = `background-image: url('${firstRelease.cover}');`;
        hasCoverClass = 'has-cover';
      } else {
        dotHtml = `<div class="calendar-day-event-dot"></div>`;
      }
      dayTooltip = releases.map(r => `• ${r.title}`).join('\n');
    }

    calendarCells.push(`
      <div class="calendar-day ${isToday ? 'today' : ''} ${hasCoverClass}" data-day="${day}" title="${dayTooltip}" style="${cellStyle}">
        <span class="calendar-day-num">${day}</span>
        ${dotHtml}
      </div>
    `);
  }

  const releasesListHtml = upcomingPlanningReleases.length > 0
    ? upcomingPlanningReleases.map(renderReleaseItemHtml).join('')
    : `<p class="stats-calendar-empty">${p.stats_no_calendar}</p>`;

  el.innerHTML = `
    <div class="home-card">
      <div class="stats-calendar-header">
        <h3 class="home-card-title">${p.stats_calendar}</h3>
        <span class="stats-calendar-month">${currentMonthName}</span>
      </div>
      <div class="stats-calendar-layout">
        <div class="calendar-grid">
          ${calendarHeaderHtml}
          ${calendarCells.join('')}
        </div>
        <div class="stats-calendar-list">
          ${releasesListHtml}
        </div>
      </div>
    </div>
  `;
}
