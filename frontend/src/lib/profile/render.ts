import { getAllLibraryEntries, getAllCatalogEntries } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { pad, typeLabel, statusLabel } from './utils';
import { getT } from '../../i18n/client';
import { buildHofHtml, initHofListeners } from './hof';
import { buildMonthlyHistoryHtml } from './monthly';
import { buildActivityHtml } from './activity';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

export async function renderOverview(el: HTMLElement, items: Items): Promise<void> {
  const t = getT();
  const p = t.profile;

  let completed = 0, inProgress = 0, planning = 0, dropped = 0;
  let totalRating = 0, ratedCount = 0, totalMinutes = 0;
  const byType: Record<string, number> = {};

  for (const item of items) {
    const s = item.status ?? 'planning';
    if (s === 'completed') completed++;
    else if (s === 'watching' || s === 'playing' || s === 'reading') inProgress++;
    else if (s === 'planning') planning++;
    else if (s === 'dropped') dropped++;

    byType[item.type] = (byType[item.type] ?? 0) + 1;

    if (item.rating)         { totalRating += item.rating; ratedCount++; }
    if (item.minutes_spent)    totalMinutes += item.minutes_spent;
  }

  const avgRating  = ratedCount > 0 ? (totalRating / ratedCount).toFixed(1) : '0.0';
  const totalHours = Math.round(totalMinutes / 60);

  const statsHtml = `
    <div class="profile-stats-bar">
      ${([
        [p.stat_total,     pad(items.length)],
        [p.stat_progress,  pad(inProgress)],
        [p.stat_completed, pad(completed)],
        [p.stat_pending,   pad(planning)],
        [p.stat_dropped,   pad(dropped)],
        [p.stat_avg,       avgRating],
        [p.stat_hours,     totalHours + 'h'],
      ] as [string, string][]).map(([label, value]) =>
        `<div class="profile-stat">
           <span class="profile-stat-value">${value}</span>
           <span class="profile-stat-label">${label}</span>
         </div>`
      ).join('')}
    </div>`;

  const typesHtml = Object.keys(byType).length > 0
    ? `<div>
         <p class="profile-section-label">${p.by_type}</p>
         <div class="type-chips">
           ${Object.entries(byType).map(([type, count]) =>
             `<span class="type-chip">
                <span class="type-chip-count">${count}</span>
                <span class="type-chip-label">${typeLabel(type)}</span>
              </span>`
           ).join('')}
         </div>
       </div>`
    : '';

  const bottomHtml = `
    <div class="profile-bottom-grid">
      <div class="profile-bottom-col">
        <p class="profile-section-label">${p.monthly_history}</p>
        ${buildMonthlyHistoryHtml(items)}
      </div>
      <div class="profile-bottom-col">
        <p class="profile-section-label">${p.recent_activity}</p>
        ${buildActivityHtml(items, p)}
      </div>
    </div>`;

  el.innerHTML = buildHofHtml(items, p) + statsHtml + typesHtml + bottomHtml;
  initHofListeners(el);
}

const TYPE_ICON: Record<string, string> = {
  game:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4m-2-2v4"/><circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/></svg>`,
  anime:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  manga:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  novel:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  book:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  movie:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M17 7h5M2 17h5M17 17h5"/></svg>`,
  series: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><path d="M17 2l-5 5-5-5"/></svg>`,
};

const CALENDAR_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function buildDateHtml(started: string | null | undefined, finished: string | null | undefined): string {
  if (!started && !finished) return '';
  const parts: string[] = [];
  if (started)  parts.push(fmtDate(started));
  if (finished) parts.push(fmtDate(finished));
  return `<span class="library-card-date">${CALENDAR_ICON}${parts.join(' → ')}</span>`;
}

export async function renderLibrary(el: HTMLElement): Promise<void> {
  const p = getT().profile;
  const [items, catalogEntries] = await Promise.all([
    getAllLibraryEntries().catch(() => []),
    getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
  ]);

  if (items.length === 0) {
    el.innerHTML = `
      <div class="profile-empty">
        <span class="profile-empty-icon">📚</span>
        <p>${p.empty}</p>
        <a href="/search">${p.empty_cta}</a>
      </div>`;
    return;
  }

  const catalogMap = new Map<string, MediaCatalogEntry>(
    catalogEntries.map(e => [e.external_id, e])
  );

  el.innerHTML = `
    <div class="library-grid">
      ${items.map(item => {
        const meta     = catalogMap.get(item.external_id);
        const title    = meta?.title_main ?? item.external_id;
        const cover    = meta?.cover_url ?? '';
        const typeIc   = TYPE_ICON[item.type] ?? TYPE_ICON['book'];
        const mediaUrl = `/media?id=${encodeURIComponent(item.external_id)}`;
        const editUrl  = `/media?id=${encodeURIComponent(item.external_id)}&edit=1`;
        const style    = cover ? `style="--cover: url('${cover}')"` : '';

        return `
          <div class="library-card" data-href="${editUrl}" ${style}>
            ${cover ? `<div class="library-card-bg"></div>` : ''}
            <a class="library-card-thumb" href="${mediaUrl}" onclick="event.stopPropagation()">
              ${cover
                ? `<img src="${cover}" alt="${title}" loading="lazy" />`
                : `<div class="library-card-no-cover"><span>${title.slice(0, 2).toUpperCase()}</span></div>`
              }
            </a>
            <div class="library-card-info">
              <span class="library-card-title">${title}</span>
              ${buildDateHtml(item.started_at, item.finished_at)}
            </div>
            <div class="library-card-type">${typeIc}</div>
          </div>`;
      }).join('')}
    </div>`;
}

export function renderStats(el: HTMLElement): void {
  const p = getT().profile;
  el.innerHTML = `<div class="profile-coming-soon"><p>📊 ${p.coming_soon}</p></div>`;
}
