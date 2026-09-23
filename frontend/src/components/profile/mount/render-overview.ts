import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { getAllLibraryEntries, getAllCharactersLight, getAllFavoriteCustomImages, readMonthlyHistoryTyped, readUserFavoritesTyped, readUserJourneyTyped } from '../../../lib/tauri';
import type { CatalogSummary, FavoriteCustomImage, DayJourney } from '../../../lib/tauri';
import { pad, typeLabel } from '../../../lib/profile/media-type-label';
import { getT } from '../../../i18n/runtime';
import { escapeHtml } from '../../../lib/shared/text/sanitize-html';
import { HofSection } from '../HofSection';
import { beginGlobalLoading } from '../../../lib/dom/global-loading';
import { ActivitySection } from '../ActivitySection';
import { buildMonthlyHistoryHtml, initMonthlyHistoryListeners } from '../../../lib/profile/monthly';
import { formatAverageScore } from '../../../lib/media/rating-utils';
import { ICON_MH_MEDIA, ICON_MH_CHARACTER } from '../../../lib/dom/icon-strings';
import { getItemMinutes, computeOverviewAggregate } from '../../../lib/profile/stats-calculators';
import { getCachedLibraryAndCatalog, getCachedMediaRelations } from '../../../lib/profile/library-data-cache';
import { syncActiveRatingSystemFromCachedInfo } from '../../../lib/profile/user-info';
import { resolveCachedCoverPaths } from '../../../lib/profile/cover-cache';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

// The Hall of Fame and Recent Activity sections are React islands mounted
// imperatively into this string-rendered tab's DOM — renderOverview rebuilds
// el.innerHTML from scratch on every tab switch, which would otherwise
// orphan the previous React roots without unmounting them.
let hofRoot: Root | null = null;
let activityRoot: Root | null = null;

// Every Tauri round trip this tab needs besides the library/catalog bundle
// — all independent of each other (none depends on another's result), so
// batched instead of a sequential await chain. Catalog entries are skipped
// entirely when the caller already has them — profile.astro's init()
// resolves the exact same scoped catalog (library-data-cache.ts) for its
// own click-delegation lookups, so refetching it again on every single
// switch to this tab was a needless duplicate query. Relations, the rating
// system and the journey come from the page-level caches for the same
// reason: the Library/Stats tabs and Recent Activity all read the same rows.
function fetchOverviewData(catalog?: CatalogSummary[] | Promise<CatalogSummary[]>) {
  return Promise.all([
    catalog ? Promise.resolve(catalog) : getCachedLibraryAndCatalog().then(bundle => bundle.catalog),
    readMonthlyHistoryTyped().catch(() => ({})),
    syncActiveRatingSystemFromCachedInfo(),
    readUserFavoritesTyped().catch(() => ({} as Record<string, string[]>)),
    getAllCharactersLight().catch(() => []),
    getAllFavoriteCustomImages().catch(() => [] as FavoriteCustomImage[]),
    // Fetched here, in parallel with everything else, instead of left to
    // ActivitySection's own on-mount fetch — that used to only start once
    // this whole function (5 other IPC round trips + the stats/HoF
    // computation below) had already finished building and mounting,
    // making "Actividad reciente" visibly the last thing to appear by a
    // wide margin even though its own fetch is cheap on its own.
    readUserJourneyTyped().catch(() => [] as DayJourney[]),
    // For computeOverviewAggregate below — anime/series seasons have no
    // format tag marking them as sub-works the way games/comics do, only
    // SEQUEL/PREQUEL relation edges between otherwise-independent entries.
    getCachedMediaRelations(),
  ]);
}

type OverviewData = Awaited<ReturnType<typeof fetchOverviewData>>;

// profile.astro starts these round trips right after the auth check, in
// the same tick as the (much larger) library/catalog fetch, so the
// overview's own data is already in flight — or landed — by the time that
// bundle resolves and renderOverview actually runs. Consumed exactly once:
// a later re-render (tab switch, 'refresh-profile-library') fetches afresh
// as it always did.
let pendingOverviewData: Promise<OverviewData> | null = null;

export function prefetchOverviewData(catalog: Promise<CatalogSummary[]>): void {
  // Started now, not once `catalog` lands — the pending catalog promise is
  // just one more member of the Promise.all.
  pendingOverviewData = fetchOverviewData(catalog);
}

export async function renderOverview(el: HTMLElement, items: Items, catalog?: CatalogSummary[]): Promise<void> {
  hofRoot?.unmount();
  hofRoot = null;
  activityRoot?.unmount();
  activityRoot = null;
  const endLoading = beginGlobalLoading();
  try {
    const t = getT();
    const p = t.profile;
    const tm = t.media;

    const prefetched = pendingOverviewData;
    pendingOverviewData = null;
    const [catalogEntries, monthlyHistory, system, favData, characterEntries, customImages, journey, sagaRelations] =
      await (prefetched ?? fetchOverviewData(catalog));
    const catalogMap = new Map<string, CatalogSummary>(
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

    const multimediaIds = favData.multimedia || [];
    const hofItems = multimediaIds.map(id => {
      const local = items.find(item => item.external_id === id);
      if (local) return local;
      const meta = catalogMap.get(id);
      // Synthetic partial entry — the Hall of Fame only reads external_id/type
      // off it (the rest comes from catalogMap).
      if (meta) return { external_id: id, type: meta.type } as Partial<Items[number]> as Items[number];
      return null;
    }).filter((item): item is Items[number] => item !== null);

    // Covers this tab paints from plain props / string HTML (Hall of Fame
    // works + each month card's headline work) — one exists-only check so
    // the ones Local already cached to disk load from there instead of the
    // remote CDN on every visit. Cheap (a file stat per id) and resolved
    // before el.innerHTML below so every <img> gets its final src directly,
    // no remote request started and then abandoned for a swap.
    const monthlyHeadlineIds = Object.values(monthlyHistory as Record<string, string[]>).map(ids => ids?.[0]).filter((id): id is string => !!id);
    const coverPathById = await resolveCachedCoverPaths([
      ...hofItems.map(item => item.external_id),
      ...monthlyHeadlineIds,
    ]);

    const bottomHtml = `
    <div class="profile-bottom-grid">
      <div class="profile-bottom-col">
        <div class="profile-section-header">
          <p class="profile-section-label">${p.monthly_history}</p>
          <div class="mh-view-toggle">
            <button type="button" class="mh-view-btn active" data-view="media" title="${escapeHtml(p.lists_type_media)}">${ICON_MH_MEDIA}</button>
            <span class="mh-view-toggle-divider"></span>
            <button type="button" class="mh-view-btn" data-view="character" title="${escapeHtml(p.monthly_view_characters_soon)}" disabled>${ICON_MH_CHARACTER}</button>
          </div>
          <div class="profile-section-line"></div>
        </div>
        ${buildMonthlyHistoryHtml(monthlyHistory, items, catalogMap, coverPathById)}
      </div>
      <div class="profile-bottom-col">
        <div class="profile-section-header">
          <p class="profile-section-label">${p.recent_activity}</p>
          <div class="profile-section-line"></div>
        </div>
        <div id="activity-mount"></div>
      </div>
    </div>`;

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
    hofRoot.render(createElement(HofSection, { items: hofItems, catalogMap, p, charFavIds, characterMap, customImageMap, coverPathById }));
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
      ${escapeHtml(getT().profile.overview_render_error.replace('{message}', message))}<br/>
      <pre>${escapeHtml(stack)}</pre>
    </div>`;
  } finally {
    endLoading();
  }
}
