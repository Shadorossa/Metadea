import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { getAllLibraryEntries, getAllCatalogEntries, getAllCharacters, getAllFavoriteCustomImages, getAllMediaRelations, readMonthlyHistory, readUserFavorites, readUserJourney } from '../tauri';
import type { MediaCatalogEntry, FavoriteCustomImage, DayJourney, DbMediaRelation } from '../tauri';
import { pad, typeLabel } from './utils';
import { getT } from '../../i18n/client';
import { HofSection } from '../../components/profile/HofSection';
import { ActivitySection } from '../../components/profile/ActivitySection';
import { buildMonthlyHistoryHtml, initMonthlyHistoryListeners } from './monthly';
import { syncActiveRatingSystem, formatAverageScore } from '../media/rating-utils';
import { ICON_MH_MEDIA, ICON_MH_CHARACTER } from '../shared/icon-strings';
import { getItemMinutes, computeOverviewAggregate } from './stats-calculators';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

// The Hall of Fame and Recent Activity sections are React islands mounted
// imperatively into this string-rendered tab's DOM — renderOverview rebuilds
// el.innerHTML from scratch on every tab switch, which would otherwise
// orphan the previous React roots without unmounting them.
let hofRoot: Root | null = null;
let activityRoot: Root | null = null;

export async function renderOverview(el: HTMLElement, items: Items, catalog?: MediaCatalogEntry[]): Promise<void> {
  hofRoot?.unmount();
  hofRoot = null;
  activityRoot?.unmount();
  activityRoot = null;
  try {
    const t = getT();
    const p = t.profile;
    const tm = t.media;

    // Five Tauri round trips are all independent (none depends on another's
    // result) — batched instead of the previous sequential await chain,
    // which added up as separate IPC latencies on every load of the
    // overview tab (the one rendered on initial page load). Catalog entries
    // are skipped here entirely when the caller already has them —
    // profile.astro's init() fetches the exact same getAllCatalogEntries()
    // for its own click-delegation lookups, so refetching it again on every
    // single switch to this tab was a needless duplicate query.
    const [catalogEntries, monthlyHistory, system, favData, characterEntries, customImages, journey, sagaRelations] = await Promise.all([
      catalog ? Promise.resolve(catalog) : getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
      readMonthlyHistory().catch(() => ({})),
      syncActiveRatingSystem(),
      readUserFavorites().catch(() => ({} as Record<string, string[]>)),
      getAllCharacters().catch(() => []),
      getAllFavoriteCustomImages().catch(() => [] as FavoriteCustomImage[]),
      // Fetched here, in parallel with everything else, instead of left to
      // ActivitySection's own on-mount fetch — that used to only start once
      // this whole function (5 other IPC round trips + the stats/HoF
      // computation below) had already finished building and mounting,
      // making "Actividad reciente" visibly the last thing to appear by a
      // wide margin even though its own fetch is cheap on its own.
      readUserJourney().catch(() => [] as DayJourney[]),
      // For computeOverviewAggregate below — anime/series seasons have no
      // format tag marking them as sub-works the way games/comics do, only
      // SEQUEL/PREQUEL relation edges between otherwise-independent entries.
      getAllMediaRelations().catch(() => [] as DbMediaRelation[]),
    ]);
    const catalogMap = new Map<string, MediaCatalogEntry>(
      catalogEntries.map(e => [e.external_id, e])
    );

    // Single source of truth for every "how many works" count — shared with
    // the Stats tab (see computeOverviewAggregate's own comment for why this
    // used to be two separately-maintained copies that could (and did)
    // drift apart on exactly this kind of saga-collapse logic).
    const {
      totalWorks, completed, currently: inProgress, planning, dropped,
      avgScore, completedByType, completedSubBreakdownByType,
    } = computeOverviewAggregate(items, catalogMap, sagaRelations);

    const avgRatingStr = avgScore > 0 ? formatAverageScore(avgScore, system) : '0.0';

    // Hours played DO include sub-work time — each logged version/season/
    // issue is real time spent, so its minutes still count toward the total.
    let totalMinutes = 0;
    for (const item of items) {
      totalMinutes += getItemMinutes(item, catalogMap);
    }
    const totalHours = Math.round(totalMinutes / 60);

    const buildSubBreakdownHtml = (byFormat: Record<string, number> | undefined) => {
      if (!byFormat) return '';
      return Object.entries(byFormat).map(([format, count]) => `
        <span class="stat-tooltip-row stat-tooltip-row--sub">
          <span class="stat-tooltip-label">${tm.formats[format as keyof typeof tm.formats] ?? format}</span>
          <span class="stat-tooltip-value">${count}</span>
        </span>
      `).join('');
    };

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
              ${buildSubBreakdownHtml(completedSubBreakdownByType[type])}
            `).join('')
        : `<span class="stat-tooltip-row"><span class="stat-tooltip-label">${p.stat_none}</span></span>`
      }
      </span>
    </span>
  `;

    const statsHtml = `
    <div class="profile-stats-bar">
      ${([
        [p.stat_total, pad(totalWorks)],
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
        <div class="profile-section-header">
          <p class="profile-section-label">${p.monthly_history}</p>
          <div class="mh-view-toggle">
            <button type="button" class="mh-view-btn active" data-view="media" title="Obras">${ICON_MH_MEDIA}</button>
            <span class="mh-view-toggle-divider"></span>
            <button type="button" class="mh-view-btn" data-view="character" title="Personajes (próximamente)" disabled>${ICON_MH_CHARACTER}</button>
          </div>
          <div class="profile-section-line"></div>
        </div>
        ${buildMonthlyHistoryHtml(monthlyHistory, items, catalogMap)}
      </div>
      <div class="profile-bottom-col">
        <div class="profile-section-header">
          <p class="profile-section-label">${p.recent_activity}</p>
          <div class="profile-section-line"></div>
        </div>
        <div id="activity-mount"></div>
      </div>
    </div>`;

    const multimediaIds = favData.multimedia || [];
    const hofItems = multimediaIds.map(id => {
      const local = items.find(item => item.external_id === id);
      if (local) return local;
      const meta = catalogMap.get(id);
      if (meta) return { external_id: id, type: meta.type } as any;
      return null;
    }).filter(Boolean) as Items;

    // Characters are never in media_catalog — resolved separately from their
    // own table, same as the Favorites tab.
    const characterMap = new Map(characterEntries.map(c => [c.external_id, c]));
    const charFavIds = favData.character || [];

    // Local-only cover overrides set via the Favorites tab's image editor —
    // the Hall of Fame shows the same customized crop, not the raw cover.
    const customImageMap = new Map(customImages.map(c => [c.external_id, c]));

    el.innerHTML = `<div id="hof-mount"></div>` + statsHtml + bottomHtml;
    const hofMount = el.querySelector<HTMLElement>('#hof-mount')!;
    hofRoot = createRoot(hofMount);
    hofRoot.render(createElement(HofSection, { items: hofItems, catalogMap, p, charFavIds, characterMap, customImageMap }));
    const activityMount = el.querySelector<HTMLElement>('#activity-mount')!;
    activityRoot = createRoot(activityMount);
    activityRoot.render(createElement(ActivitySection, { catalogMap, p, overrideJourney: journey }));
    const monthlyHistoryEl = el.querySelector<HTMLElement>('.monthly-history');
    if (monthlyHistoryEl) initMonthlyHistoryListeners(monthlyHistoryEl);
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
