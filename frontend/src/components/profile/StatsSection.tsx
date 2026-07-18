import { useEffect, useState } from 'react';
import { getAllLibraryEntries, getAllCatalogEntries, readUserJourney } from '../../lib/tauri';
import type { MediaCatalogEntry } from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { syncActiveRatingSystem, formatAverageScore, averageScoreSuffix, type RatingSystem } from '../../lib/media/rating-utils';
import { ICON_STACK, ICON_CLOCK, ICON_STAR, ICON_CHART, STATUS_ICONS_14 } from '../../lib/shared/icon-strings';
import { TYPE_LABELS } from '../../lib/constants/media';
import {
  computeOverviewAggregate,
  computeTypeBreakdown,
  computeTopGenres,
  computeScoreDistribution,
  computeCompletedByYear,
  computeActivityHeatmap,
} from '../../lib/profile/stats-calculators';
import { formatDateShort } from '../../lib/shared/formatDate';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

interface StatsData {
  items: Items;
  catalogMap: Map<string, MediaCatalogEntry>;
  system: RatingSystem;
  journey: Awaited<ReturnType<typeof readUserJourney>>;
}

export function StatsSection() {
  const t = getT();
  const p = t.profile;
  const [data, setData] = useState<StatsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [items, catalogEntries, system, journey] = await Promise.all([
        getAllLibraryEntries().catch(() => [] as Items),
        getAllCatalogEntries().catch(() => [] as MediaCatalogEntry[]),
        syncActiveRatingSystem(),
        readUserJourney().catch(() => []),
      ]);
      if (cancelled) return;
      const catalogMap = new Map<string, MediaCatalogEntry>(catalogEntries.map(e => [e.external_id, e]));
      setData({ items, catalogMap, system, journey });
    })();
    return () => { cancelled = true; };
  }, []);

  if (!data) {
    return <div className="profile-empty"><p>{p.stats_loading}</p></div>;
  }

  const { items, catalogMap, system, journey } = data;

  if (items.length === 0) {
    return (
      <div className="profile-empty">
        <span className="profile-empty-icon">📊</span>
        <p>{p.stats_empty}</p>
        <a href="/search">{p.empty_cta}</a>
      </div>
    );
  }

  // Fetched early so hours math below can look up per-episode/movie runtime
  const { totalWorks, totalSeasons, totalHours, totalDays, avgPerWork, ratedItems, avgScore, completed, currently, paused, dropped, planning } =
    computeOverviewAggregate(items, catalogMap);

  const byType = computeTypeBreakdown(items, catalogMap);

  const statusList = [
    { label: p.section_completed, value: completed, color: 'completed', icon: STATUS_ICONS_14.completed },
    { label: p.section_in_progress, value: currently, color: 'in_progress', icon: STATUS_ICONS_14.in_progress },
    { label: p.section_planning, value: planning, color: 'planning', icon: STATUS_ICONS_14.planning },
    { label: p.section_paused, value: paused, color: 'paused', icon: STATUS_ICONS_14.paused },
    { label: p.section_dropped, value: dropped, color: 'dropped', icon: STATUS_ICONS_14.dropped },
  ].filter(s => s.value > 0);

  const avgScoreStr = avgScore > 0
    ? formatAverageScore(avgScore, system) + averageScoreSuffix(system)
    : '—';

  const currentYear = new Date().getFullYear();

  /* ── Activity heatmap ─────────────────────────────────────────────────── */
  const heatmapData = computeActivityHeatmap(journey);

  /* ── Advanced stats ───────────────────────────────────────────────────── */
  const topGenres = computeTopGenres(items, catalogMap);
  const maxGenreCount = topGenres.length > 0 ? topGenres[0][1] : 1;

  const scoreDist = computeScoreDistribution(ratedItems, system);
  const maxScoreCount = Math.max(...scoreDist.map(s => s.count), 1);

  const yearEntries = computeCompletedByYear(items, currentYear, catalogMap);
  const maxYearCount = Math.max(...yearEntries.map(y => y.count), 1);

  const maxHours = byType.length > 0 ? Math.max(...byType.map(t => t.hours)) : 1;

  return (
    <div className="stats-layout">

      {/* 1. KPI Cards */}
      <div className="stats-grid-5">
        <div className="stats-card">
          <div className="stats-card-icon" dangerouslySetInnerHTML={{ __html: ICON_STACK }} />
          <span className="stats-card-label">{p.stat_total}</span>
          <span className="stats-card-value">{totalWorks.toLocaleString()}</span>
        </div>
        <div className="stats-card">
          <div className="stats-card-icon" dangerouslySetInnerHTML={{ __html: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>` }} />
          <span className="stats-card-label">Temporadas</span>
          <span className="stats-card-value">{totalSeasons.toLocaleString()}</span>
        </div>
        <div className="stats-card">
          <div className="stats-card-icon" dangerouslySetInnerHTML={{ __html: ICON_CLOCK }} />
          <span className="stats-card-label">{p.stat_hours}</span>
          <span className="stats-card-value">{totalHours.toFixed(0)}</span>
          {totalHours > 0 && <span className="stats-card-sub">{totalDays} d · {avgPerWork} h/obra</span>}
        </div>
        <div className="stats-card">
          <div className="stats-card-icon" dangerouslySetInnerHTML={{ __html: ICON_STAR }} />
          <span className="stats-card-label">{p.stat_avg}</span>
          <span className="stats-card-value">{avgScoreStr}</span>
        </div>
        <div className="stats-card">
          <div className="stats-card-icon" dangerouslySetInnerHTML={{ __html: ICON_CHART }} />
          <span className="stats-card-label">{p.stats_rated}</span>
          <span className="stats-card-value">{ratedItems.length.toLocaleString()}</span>
        </div>
      </div>

      {/* 2. Status + Time by category (side by side) */}
      <div className="stats-main-pair">

        {statusList.length > 0 && (
          <div className="stats-block-custom">
            <h3 className="stats-block-title">{p.stats_by_status}</h3>
            <div className="stats-status-list">
              {statusList.map(s => {
                const pct = ((s.value / totalWorks) * 100).toFixed(0);
                return (
                  <div className="stats-status-row" key={s.color}>
                    <div className="stats-status-icon" dangerouslySetInnerHTML={{ __html: s.icon }} />
                    <span className="stats-status-label">{s.label}</span>
                    <progress className={`stats-bar-outer ${s.color}`} value={s.value} max={totalWorks} />
                    <span className="stats-status-count">{s.value}</span>
                    <span className="stats-status-percent">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {byType.length > 0 && (
          <div className="stats-block-custom">
            <h3 className="stats-block-title">{p.stats_by_time}</h3>
            <div className="stats-time-bars">
              {byType.map(tEntry => {
                const label = TYPE_LABELS[tEntry.type] || tEntry.type;
                return (
                  <div className="stats-time-row" key={tEntry.type}>
                    <div className="stats-time-meta">
                      <span className="stats-time-label">{label}</span>
                      <span className="stats-time-value">{tEntry.hours.toFixed(0)} h <span className="stats-time-count">({tEntry.count})</span></span>
                    </div>
                    <progress className="stats-bar-outer stats-bar-outer--time" value={tEntry.hours} max={maxHours} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

      </div>

      {/* 3. Insight trio: Genres · Score distribution · Completed by year */}
      {(topGenres.length > 0 || ratedItems.length > 0 || yearEntries.length > 0) && (
        <div className="stats-insight-trio">

          {topGenres.length > 0 && (
            <div className="stats-block-custom">
              <h3 className="stats-block-title">{p.stats_genres}</h3>
              <div className="stats-histogram">
                {topGenres.map(([genre, count]) => (
                  <div className="stats-hist-row" key={genre}>
                    <span className="stats-hist-label">{genre}</span>
                    <progress className="stats-hist-bar-outer" value={count} max={maxGenreCount} />
                    <span className="stats-hist-count">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ratedItems.length > 0 && (
            <div className="stats-block-custom">
              <h3 className="stats-block-title">{p.stats_score_dist}</h3>
              <div className="stats-histogram">
                {scoreDist.map(s => (
                  <div className="stats-hist-row" key={s.label}>
                    <span className="stats-hist-label">{s.label}</span>
                    <progress className="stats-hist-bar-outer stats-hist-bar-outer--score" value={s.count} max={maxScoreCount} />
                    <span className="stats-hist-count">{s.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {yearEntries.length > 0 && (
            <div className="stats-block-custom">
              <h3 className="stats-block-title">{p.stats_by_year}</h3>
              <div className="stats-histogram">
                {yearEntries.map(y => (
                  <div className="stats-hist-row" key={y.year}>
                    <span className="stats-hist-label">{y.year}</span>
                    <progress className="stats-hist-bar-outer stats-hist-bar-outer--year" value={y.count} max={maxYearCount} />
                    <span className="stats-hist-count">{y.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}

      {/* 4. Activity Heatmap (full width) */}
      <div className="stats-block-custom">
        <h3 className="stats-block-title">{p.stats_heatmap}</h3>
        <div className="stats-heatmap-grid">
          {heatmapData.map(({ date, dateKey, count, level }) => {
            const formattedDate = formatDateShort(date);
            const tooltipText = `${formattedDate}: ${count} ${count === 1 ? 'actividad' : 'actividades'}`;
            return <div className={`heatmap-cell level-${level}`} key={dateKey} data-date={dateKey} data-tooltip={tooltipText} />;
          })}
        </div>
        <div className="stats-heatmap-legend">
          <span>Menos</span>
          <div className="heatmap-legend-cell" style={{ background: 'rgba(255,255,255,0.02)' }} />
          <div className="heatmap-legend-cell" style={{ background: 'color-mix(in srgb, var(--accent) 25%, rgba(255,255,255,0.02))' }} />
          <div className="heatmap-legend-cell" style={{ background: 'color-mix(in srgb, var(--accent) 50%, rgba(255,255,255,0.02))' }} />
          <div className="heatmap-legend-cell" style={{ background: 'color-mix(in srgb, var(--accent) 75%, rgba(255,255,255,0.02))' }} />
          <div className="heatmap-legend-cell" style={{ background: 'var(--accent)', boxShadow: '0 0 4px var(--accent)' }} />
          <span>Más</span>
        </div>
      </div>

    </div>
  );
}
