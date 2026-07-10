import { getAllLibraryEntries, getAllCatalogEntries, readMonthlyHistory, readUserFavorites } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { pad, typeLabel } from './utils';
import { getT } from '../../i18n/client';
import { buildHofHtml, initHofListeners } from './hof';
import { buildMonthlyHistoryHtml } from './monthly';
import { buildActivityHtml, initActivityListeners } from './activity';
import { syncActiveRatingSystem, formatAverageScore } from '../media/rating-utils';
import { isInProgressStatus, GAME_FORMAT_LABELS } from '../constants/media';
import { getNonEditionItems, getEditionItems, getItemMinutes } from './stats-calculators';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

export async function renderOverview(el: HTMLElement, items: Items): Promise<void> {
  try {
    const t = getT();
    const p = t.profile;

    const catalogEntries = await getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]);
    const catalogMap = new Map<string, MediaCatalogEntry>(
      catalogEntries.map(e => [e.external_id, e])
    );

    const monthlyHistory = await readMonthlyHistory().catch(() => ({}));

    let completed = 0, inProgress = 0, planning = 0, dropped = 0;
    let totalRating = 0, ratedCount = 0, totalMinutes = 0;
    const completedByType: Record<string, number> = {};

    // Version-log child entries (tracking one specific edition/platform of a
    // work) shouldn't be counted as separate works — same exclusion as the
    // rest of the stats dashboard.
    const nonEditionItems = getNonEditionItems(items);
    for (const item of nonEditionItems) {
      const s = item.status ?? 'planning';
      if (s === 'completed') {
        completed++;
        completedByType[item.type] = (completedByType[item.type] ?? 0) + 1;
      }
      else if (isInProgressStatus(s)) inProgress++;
      else if (s === 'planning') planning++;
      else if (s === 'dropped') dropped++;

      if (item.rating) { totalRating += item.rating; ratedCount++; }
    }

    // Completed version-logs don't count as their own "work", but the info
    // isn't thrown away — tally them by edition type (remake/remaster/port/…)
    // so the "?" tooltip can show that breakdown under Videojuegos.
    const completedVersionsByFormat: Record<string, number> = {};
    for (const item of getEditionItems(items)) {
      if (item.status !== 'completed') continue;
      const format = catalogMap.get(item.external_id)?.format || 'GAME';
      completedVersionsByFormat[format] = (completedVersionsByFormat[format] ?? 0) + 1;
    }

    // Hours played DO include version-log time — each logged version is a
    // real playthrough, so its minutes still count toward total time spent.
    for (const item of items) {
      totalMinutes += getItemMinutes(item, catalogMap);
    }

    const system = await syncActiveRatingSystem();
    const avgRatingStr = ratedCount > 0
      ? formatAverageScore(totalRating / ratedCount, system)
      : '0.0';

    const totalHours = Math.round(totalMinutes / 60);

    const versionBreakdownHtml = Object.entries(completedVersionsByFormat)
      .map(([format, count]) => `
        <span class="stat-tooltip-row stat-tooltip-row--sub">
          <span class="stat-tooltip-label">${GAME_FORMAT_LABELS[format] ?? format}</span>
          <span class="stat-tooltip-value">${count}</span>
        </span>
      `).join('');

    const completedTooltipHtml = `
    <span class="stat-help-wrap">
      <span class="stat-help-icon">?</span>
      <span class="stat-tooltip">
        ${Object.entries(completedByType).length > 0
        ? Object.entries(completedByType).map(([type, count]) => `
              <span class="stat-tooltip-row">
                <span class="stat-tooltip-label">${typeLabel(type)}</span>
                <span class="stat-tooltip-value">${count}</span>
              </span>
              ${type === 'game' ? versionBreakdownHtml : ''}
            `).join('')
        : `<span class="stat-tooltip-row"><span class="stat-tooltip-label">Ninguno</span></span>`
      }
      </span>
    </span>
  `;

    const statsHtml = `
    <div class="profile-stats-bar">
      ${([
        [p.stat_total, pad(nonEditionItems.length)],
        [p.stat_progress, pad(inProgress)],
        [p.stat_completed, pad(completed)],
        [p.stat_pending, pad(planning)],
        [p.stat_dropped, pad(dropped)],
        [p.stat_avg, avgRatingStr],
        [p.stat_hours, totalHours + 'h'],
      ] as [string, string][]).map(([label, value]) =>
        `<div class="profile-stat">
           <span class="profile-stat-value">${value}</span>
           <span class="profile-stat-label">
             ${label}
             ${label === p.stat_completed ? completedTooltipHtml : ''}
           </span>
         </div>`
      ).join('')}
    </div>`;

    const bottomHtml = `
    <div class="profile-bottom-grid">
      <div class="profile-bottom-col">
        <p class="profile-section-label">${p.monthly_history}</p>
        ${buildMonthlyHistoryHtml(monthlyHistory, items, catalogMap)}
      </div>
      <div class="profile-bottom-col">
        <p class="profile-section-label">${p.recent_activity}</p>
        ${await buildActivityHtml(catalogMap, p)}
      </div>
    </div>`;

    const favData = await readUserFavorites().catch(() => ({} as Record<string, string[]>));
    const multimediaIds = favData.multimedia || [];
    const hofItems = multimediaIds.map(id => items.find(item => item.external_id === id)).filter(Boolean) as Items;

    el.innerHTML = buildHofHtml(hofItems, catalogMap, p) + statsHtml + bottomHtml;
    initHofListeners(el);
    initActivityListeners(el, catalogMap, p);
  } catch (error) {
    console.error("renderOverview failed:", error);
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack ?? '' : '';
    el.innerHTML = `<div style="padding: 2rem; color: #ef4444; font-family: monospace; font-size: 0.9rem;">
      Error al renderizar perfil: ${message}<br/>
      <pre>${stack}</pre>
    </div>`;
  }
}
