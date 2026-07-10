import { getAllLibraryEntries, getAllCatalogEntries, readUserJourney } from '../tauri';
import type { MediaCatalogEntry } from '../tauri';
import { getT } from '../../i18n/client';
import { syncActiveRatingSystem, formatAverageScore, averageScoreSuffix } from '../media/rating-utils';
import { ICON_STACK, ICON_CLOCK, ICON_STAR, ICON_CHART, STATUS_ICONS_14 } from '../shared/icon-strings';
import { TYPE_LABELS } from '../constants/media';
import {
  computeOverviewAggregate,
  computeTypeBreakdown,
  computeTopGenres,
  computeScoreDistribution,
  computeCompletedByYear,
  computeActivityHeatmap,
} from './stats-calculators';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

export async function renderStats(el: HTMLElement): Promise<void> {
  const t = getT();
  const p = t.profile;

  el.innerHTML = `<div class="profile-empty"><p>${p.stats_loading}</p></div>`;

  const items = await getAllLibraryEntries().catch(() => [] as Items);

  if (items.length === 0) {
    el.innerHTML = `
      <div class="profile-empty">
        <span class="profile-empty-icon">📊</span>
        <p>${p.stats_empty}</p>
        <a href="/search">${p.empty_cta}</a>
      </div>`;
    return;
  }

  // Fetched early so hours math below can look up per-episode/movie runtime
  // (media_catalog.time_length) for anime/series instead of trusting the
  // flat progress*60 stored on minutes_spent.
  const catalogEntries = await getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]);
  const catalogMap = new Map<string, MediaCatalogEntry>(
    catalogEntries.map(e => [e.external_id, e])
  );

  const { totalWorks, totalHours, totalDays, avgPerWork, ratedItems, avgScore, completed, currently, paused, dropped, planning } =
    computeOverviewAggregate(items, catalogMap);

  const byType = computeTypeBreakdown(items, catalogMap);

  const statusList = [
    { label: p.section_completed, value: completed, color: 'completed', icon: STATUS_ICONS_14.completed },
    { label: p.section_in_progress, value: currently, color: 'in_progress', icon: STATUS_ICONS_14.in_progress },
    { label: p.section_planning, value: planning, color: 'planning', icon: STATUS_ICONS_14.planning },
    { label: p.section_paused, value: paused, color: 'paused', icon: STATUS_ICONS_14.paused },
    { label: p.section_dropped, value: dropped, color: 'dropped', icon: STATUS_ICONS_14.dropped },
  ].filter(s => s.value > 0);

  const system = await syncActiveRatingSystem();
  const avgScoreStr = avgScore > 0
    ? formatAverageScore(avgScore, system) + averageScoreSuffix(system)
    : '—';

  const currentYear = new Date().getFullYear();

  /* ── Activity heatmap ─────────────────────────────────────────────────── */
  const journey = await readUserJourney().catch(() => []);
  const heatmapData = computeActivityHeatmap(journey);
  const heatmapCells = heatmapData.map(({ date, dateKey, count, level }) => {
    const formattedDate = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    const tooltipText = `${formattedDate}: ${count} ${count === 1 ? 'actividad' : 'actividades'}`;
    return `<div class="heatmap-cell level-${level}" data-date="${dateKey}" data-tooltip="${tooltipText}"></div>`;
  });

  /* ── Advanced stats ───────────────────────────────────────────────────── */
  const topGenres = computeTopGenres(items, catalogMap);
  const maxGenreCount = topGenres.length > 0 ? topGenres[0][1] : 1;

  const scoreDist = computeScoreDistribution(ratedItems, system);
  const maxScoreCount = Math.max(...scoreDist.map(s => s.count), 1);

  const yearEntries = computeCompletedByYear(items, currentYear);
  const maxYearCount = Math.max(...yearEntries.map(y => y.count), 1);

  /* ── Render dashboard ─────────────────────────────────────────────────── */
  const maxHours = byType.length > 0 ? Math.max(...byType.map(t => t.hours)) : 1;

  el.innerHTML = `
    <div class="stats-layout">

      <!-- 1. KPI Cards -->
      <div class="stats-grid-4">
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_STACK}</div>
          <span class="stats-card-label">${p.stat_total}</span>
          <span class="stats-card-value">${totalWorks.toLocaleString()}</span>
        </div>
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_CLOCK}</div>
          <span class="stats-card-label">${p.stat_hours}</span>
          <span class="stats-card-value">${totalHours.toFixed(0)}</span>
          ${totalHours > 0 ? `<span class="stats-card-sub">${totalDays} d · ${avgPerWork} h/obra</span>` : ''}
        </div>
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_STAR}</div>
          <span class="stats-card-label">${p.stat_avg}</span>
          <span class="stats-card-value">${avgScoreStr}</span>
        </div>
        <div class="stats-card">
          <div class="stats-card-icon">${ICON_CHART}</div>
          <span class="stats-card-label">${p.stats_rated}</span>
          <span class="stats-card-value">${ratedItems.length.toLocaleString()}</span>
        </div>
      </div>

      <!-- 2. Status + Time by category (side by side) -->
      <div class="stats-main-pair">

        ${statusList.length > 0 ? `
          <div class="stats-block-custom">
            <h3 class="stats-block-title">${p.stats_by_status}</h3>
            <div class="stats-status-list">
              ${statusList.map(s => {
    const pct = ((s.value / totalWorks) * 100).toFixed(0);
    const pctPrecise = ((s.value / totalWorks) * 100).toFixed(1);
    return `
                  <div class="stats-status-row">
                    <div class="stats-status-icon">${s.icon}</div>
                    <span class="stats-status-label">${s.label}</span>
                    <div class="stats-bar-outer">
                      <div class="stats-bar-inner ${s.color}" style="width: ${pctPrecise}%"></div>
                    </div>
                    <span class="stats-status-count">${s.value}</span>
                    <span class="stats-status-percent">${pct}%</span>
                  </div>
                `;
  }).join('')}
            </div>
          </div>
        ` : ''}

        ${byType.length > 0 ? `
          <div class="stats-block-custom">
            <h3 class="stats-block-title">${p.stats_by_time}</h3>
            <div class="stats-time-bars">
              ${byType.map(tEntry => {
    const label = TYPE_LABELS[tEntry.type] || tEntry.type;
    const percent = maxHours > 0 ? (tEntry.hours / maxHours) * 100 : 0;
    return `
                  <div class="stats-time-row">
                    <div class="stats-time-meta">
                      <span class="stats-time-label">${label}</span>
                      <span class="stats-time-value">${tEntry.hours.toFixed(0)} h <span class="stats-time-count">(${tEntry.count})</span></span>
                    </div>
                    <div class="stats-bar-outer">
                      <div class="stats-bar-inner" style="width: ${percent}%; background: var(--accent); box-shadow: 0 0 6px var(--accent);"></div>
                    </div>
                  </div>
                `;
  }).join('')}
            </div>
          </div>
        ` : ''}

      </div>

      <!-- 3. Insight trio: Genres · Score distribution · Completed by year -->
      ${(topGenres.length > 0 || ratedItems.length > 0 || yearEntries.length > 0) ? `
        <div class="stats-insight-trio">

          ${topGenres.length > 0 ? `
            <div class="stats-block-custom">
              <h3 class="stats-block-title">${p.stats_genres}</h3>
              <div class="stats-histogram">
                ${topGenres.map(([genre, count]) => `
                  <div class="stats-hist-row">
                    <span class="stats-hist-label">${genre}</span>
                    <div class="stats-hist-bar-outer">
                      <div class="stats-hist-bar-inner" style="width:${(count / maxGenreCount) * 100}%"></div>
                    </div>
                    <span class="stats-hist-count">${count}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${ratedItems.length > 0 ? `
            <div class="stats-block-custom">
              <h3 class="stats-block-title">${p.stats_score_dist}</h3>
              <div class="stats-histogram">
                ${scoreDist.map(s => `
                  <div class="stats-hist-row">
                    <span class="stats-hist-label">${s.label}</span>
                    <div class="stats-hist-bar-outer">
                      <div class="stats-hist-bar-inner" style="width:${(s.count / maxScoreCount) * 100}%;background:color-mix(in srgb, var(--accent) 65%, #818cf8);"></div>
                    </div>
                    <span class="stats-hist-count">${s.count}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${yearEntries.length > 0 ? `
            <div class="stats-block-custom">
              <h3 class="stats-block-title">${p.stats_by_year}</h3>
              <div class="stats-histogram">
                ${yearEntries.map(y => `
                  <div class="stats-hist-row">
                    <span class="stats-hist-label">${y.year}</span>
                    <div class="stats-hist-bar-outer">
                      <div class="stats-hist-bar-inner" style="width:${(y.count / maxYearCount) * 100}%;background:color-mix(in srgb, var(--accent) 50%, #a78bfa);"></div>
                    </div>
                    <span class="stats-hist-count">${y.count}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

        </div>
      ` : ''}

      <!-- 4. Activity Heatmap (full width) -->
      <div class="stats-block-custom">
        <h3 class="stats-block-title">${p.stats_heatmap}</h3>
        <div class="stats-heatmap-grid">
          ${heatmapCells.join('')}
        </div>
        <div class="stats-heatmap-legend">
          <span>Menos</span>
          <div class="heatmap-legend-cell" style="background: rgba(255,255,255,0.02);"></div>
          <div class="heatmap-legend-cell" style="background: color-mix(in srgb, var(--accent) 25%, rgba(255,255,255,0.02));"></div>
          <div class="heatmap-legend-cell" style="background: color-mix(in srgb, var(--accent) 50%, rgba(255,255,255,0.02));"></div>
          <div class="heatmap-legend-cell" style="background: color-mix(in srgb, var(--accent) 75%, rgba(255,255,255,0.02));"></div>
          <div class="heatmap-legend-cell" style="background: var(--accent); box-shadow: 0 0 4px var(--accent);"></div>
          <span>Más</span>
        </div>
      </div>

    </div>
  `;
}
