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
        const meta   = catalogMap.get(item.external_id);
        const title  = meta?.title_main ?? item.external_id;
        const cover  = meta?.cover_url ?? '';
        const status = statusLabel(item.status ?? 'planning');
        const url    = `/media?id=${encodeURIComponent(item.external_id)}`;
        return `
          <a class="library-card" href="${url}" title="${title}">
            <div class="library-card-cover">
              ${cover
                ? `<img src="${cover}" alt="${title}" loading="lazy" />`
                : `<div class="library-card-no-cover"><span>${title.slice(0, 2).toUpperCase()}</span></div>`
              }
              <span class="library-card-status">${status}</span>
              ${item.rating ? `<span class="library-card-rating">★ ${item.rating}</span>` : ''}
            </div>
            <p class="library-card-title">${title}</p>
          </a>`;
      }).join('')}
    </div>`;
}

export function renderStats(el: HTMLElement): void {
  const p = getT().profile;
  el.innerHTML = `<div class="profile-coming-soon"><p>📊 ${p.coming_soon}</p></div>`;
}
