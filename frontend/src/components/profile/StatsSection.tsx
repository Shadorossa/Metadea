import { useEffect, useState } from 'react';
import { getAllLibraryEntries, readUserJourneyTyped } from '../../lib/tauri';
import type { CatalogSummary, DbMediaRelation } from '../../lib/tauri';
import { getCachedLibraryAndCatalog, getCachedMediaRelations } from '../../lib/profile/library-data-cache';
import { syncActiveRatingSystemFromCachedInfo } from '../../lib/profile/user-info';
import { beginGlobalLoading } from '../../lib/dom/global-loading';
import { getT } from '../../i18n/runtime';
import { getActiveRatingSystem, formatAverageScore, averageScoreSuffix, type RatingSystem } from '../../lib/media/rating-utils';
import { ICON_STACK, ICON_CLOCK, ICON_STAR, ICON_CHART, STATUS_ICONS_14 } from '../../lib/dom/icon-strings';
import { getTypeLabel, getGenreLabel } from '../../lib/media/media-types';
import {
  computeOverviewAggregate,
  computeTypeBreakdown,
  computeTopGenres,
  computeScoreDistribution,
  computeCompletedByYear,
  computeActivityHeatmap,
} from '../../lib/profile/stats-calculators';
import { formatDateShort } from '../../lib/shared/text/format-date';
import { BacklogEstimate } from './BacklogEstimate';

// Not in icon-strings.ts (a "seasons"/folder-stack glyph specific to this
// one KPI card, not reused anywhere else) — kept local instead.
const SEASONS_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

type Items = Awaited<ReturnType<typeof getAllLibraryEntries>>;

interface StatsData {
  items: Items;
  catalogMap: Map<string, CatalogSummary>;
  system: RatingSystem;
  journey: Awaited<ReturnType<typeof readUserJourneyTyped>>;
  relations: DbMediaRelation[];
}

interface Props {
  // Someone else's profile (UserProfileView) already has the mapped
  // library, the viewer's own catalogMap, the reshaped activity journey and
  // the scoped saga relations in hand — passing them in skips this
  // component's own local-only fetch. Every stat here is computed purely
  // from those inputs — including the owner's real minutes_spent when their
  // app synced it (toLibraryEntry only estimates it for older profiles).
  overrideItems?: Items;
  overrideCatalogMap?: Map<string, CatalogSummary>;
  overrideJourney?: StatsData['journey'];
  overrideRelations?: DbMediaRelation[];
  /** Someone else's profile: no "add something" call to action. */
  readOnly?: boolean;
}

export function StatsSection({ overrideItems, overrideCatalogMap, overrideJourney, overrideRelations, readOnly }: Props = {}) {
  const t = getT();
  const p = t.profile;
  const [hoveredScoreLabel, setHoveredScoreLabel] = useState<string | null>(null);
  const [data, setData] = useState<StatsData | null>(
    overrideItems ? { items: overrideItems, catalogMap: overrideCatalogMap ?? new Map(), system: getActiveRatingSystem(), journey: overrideJourney ?? [], relations: overrideRelations ?? [] } : null
  );

  useEffect(() => {
    if (overrideItems) return;
    let cancelled = false;
    const endLoading = beginGlobalLoading();
    (async () => {
      try {
        const [{ items, catalog: catalogEntries }, system, journey, relations] = await Promise.all([
          getCachedLibraryAndCatalog(),
          syncActiveRatingSystemFromCachedInfo(),
          readUserJourneyTyped().catch(() => []),
          getCachedMediaRelations(),
        ]);
        if (cancelled) return;
        const catalogMap = new Map<string, CatalogSummary>(catalogEntries.map(e => [e.external_id, e]));
        setData({ items, catalogMap, system, journey, relations });
      } finally {
        endLoading();
      }
    })();
    return () => { cancelled = true; };
  }, [overrideItems]);

  // No blocking "Cargando..." placeholder — the global bottom loading bar
  // (BaseLayout.astro) shows the fetch is in flight; render nothing until
  // it resolves, since everything below reads straight off `data`.
  if (!data) {
    return null;
  }

  const { items, catalogMap, system, journey, relations } = data;

  if (items.length === 0) {
    return (
      <div className="profile-empty">
        <span className="profile-empty-icon">📊</span>
        <p>{p.stats_empty}</p>
        {!readOnly && <a href="/search">{p.empty_cta}</a>}
      </div>
    );
  }

  // Fetched early so hours math below can look up per-episode/movie runtime
  const { totalWorks, totalSeasons, totalHours, totalDays, avgPerWork, ratedItems, avgScore, completed, currently, paused, dropped, planning } =
    computeOverviewAggregate(items, catalogMap, relations);

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
  const scoreDonutColors = ['#b59acb', '#987fae', '#806994', '#b5a2c7', '#d0bd8d', '#ad8d54', '#8ca9bb', '#7194a8', '#d19c77', '#b87769'];
  const scoreDonutRadius = 48;
  const scoreDonutCircumference = 2 * Math.PI * scoreDonutRadius;
  const scoreDonutTotal = scoreDist.reduce((sum, score) => sum + score.count, 0);
  let scoreDonutOffset = 0;
  const scoreDonutSegments = scoreDist.map((score, index) => {
    const length = scoreDonutTotal > 0 ? (score.count / scoreDonutTotal) * scoreDonutCircumference : 0;
    const segment = { ...score, color: scoreDonutColors[index % scoreDonutColors.length], length, offset: scoreDonutOffset };
    scoreDonutOffset += length;
    return segment;
  });
  const hoveredScore = scoreDonutSegments.find(segment => segment.label === hoveredScoreLabel);

  const yearEntries = computeCompletedByYear(items, currentYear, catalogMap);
  const yearChartWidth = 1000;
  const yearChartHeight = 220;
  const yearChartPaddingX = 28;
  const yearChartTop = 30;
  const yearChartBottom = 174;
  const maxYearCount = Math.max(...yearEntries.map(y => y.count), 1);
  const yearChartPoints = yearEntries.map((entry, index) => {
    const x = yearEntries.length <= 1
      ? yearChartWidth / 2
      : yearChartPaddingX + (index * (yearChartWidth - yearChartPaddingX * 2)) / (yearEntries.length - 1);
    const y = yearChartBottom - (entry.count / maxYearCount) * (yearChartBottom - yearChartTop);
    return { ...entry, x, y };
  });
  const yearChartPath = yearChartPoints.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = yearChartPoints[index - 1];
    const midpointX = (previous.x + point.x) / 2;
    return `${path} C ${midpointX} ${previous.y}, ${midpointX} ${point.y}, ${point.x} ${point.y}`;
  }, '');

  const maxHours = byType.length > 0 ? Math.max(...byType.map(t => t.hours)) : 1;

  // The five KPI cards above the fold differ only in icon/label/value(/sub)
  // — one {icon,label,value,sub}[] + a single .map() instead of five
  // hand-rolled, near-identical <div className="stats-card"> blocks.
  const kpiCards: { icon: string; label: string; value: string; sub?: string }[] = [
    { icon: ICON_STACK, label: p.stat_total, value: totalWorks.toLocaleString() },
    { icon: SEASONS_ICON, label: p.stat_seasons, value: totalSeasons.toLocaleString() },
    {
      icon: ICON_CLOCK, label: p.stat_hours, value: totalHours.toFixed(0),
      sub: totalHours > 0
        ? p.stats_hours_sub.replace('{days}', String(totalDays)).replace('{avg}', String(avgPerWork))
        : undefined,
    },
    { icon: ICON_STAR, label: p.stat_avg, value: avgScoreStr },
    { icon: ICON_CHART, label: p.stats_rated, value: ratedItems.length.toLocaleString() },
  ];

  return (
    <div className="stats-layout">

      {/* 1. KPI Cards */}
      <div className="stats-grid-5">
        {kpiCards.map((card, i) => (
          <div className="stats-card" key={i}>
            <div className="stats-card-header">
              <div className="stats-card-icon" dangerouslySetInnerHTML={{ __html: card.icon }} />
              <span className="stats-card-label">{card.label}</span>
            </div>
            <span className="stats-card-value">{card.value}</span>
            {card.sub && <span className="stats-card-sub">{card.sub}</span>}
          </div>
        ))}
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
                const label = getTypeLabel(tEntry.type);
                return (
                  <div className="stats-time-row" key={tEntry.type}>
                    <span className="stats-time-label">{label}</span>
                    <progress className="stats-bar-outer stats-bar-outer--time" value={tEntry.hours} max={maxHours} />
                    <span className="stats-time-value">{tEntry.hours.toFixed(0)} h <span className="stats-time-count">({tEntry.count})</span></span>
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
                    <span className="stats-hist-label">{getGenreLabel(genre)}</span>
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
              <div className="stats-score-donut-layout" onMouseLeave={() => setHoveredScoreLabel(null)}>
                <svg className="stats-score-donut" viewBox="0 0 120 120" role="img" aria-label={p.stats_score_dist}>
                  <circle className="stats-score-donut-track" cx="60" cy="60" r={scoreDonutRadius} />
                  <g transform="rotate(-90 60 60)">
                    {scoreDonutSegments.map(segment => (
                      <circle
                        className={`stats-score-donut-segment${hoveredScoreLabel === segment.label ? ' is-active' : ''}`}
                        key={segment.label}
                        cx="60"
                        cy="60"
                        r={scoreDonutRadius}
                        stroke={segment.color}
                        strokeDasharray={`${segment.length} ${scoreDonutCircumference - segment.length}`}
                        strokeDashoffset={-segment.offset}
                        tabIndex={0}
                        role="img"
                        aria-label={`${segment.count} obras con puntuación ${segment.label}`}
                        onMouseEnter={() => setHoveredScoreLabel(segment.label)}
                        onFocus={() => setHoveredScoreLabel(segment.label)}
                        onBlur={() => setHoveredScoreLabel(null)}
                      />
                    ))}
                  </g>
                  <text className="stats-score-donut-total" x="60" y={hoveredScore ? '57' : '64'} textAnchor="middle">
                    {hoveredScore ? hoveredScore.count : scoreDonutTotal}
                  </text>
                  {hoveredScore && (
                    <text className="stats-score-donut-detail" x="60" y="76" textAnchor="middle">
                      {`puntuación ${hoveredScore.label}`}
                    </text>
                  )}
                </svg>
              </div>
            </div>
          )}

          {yearEntries.length > 0 && (
            <div className="stats-block-custom stats-block-custom--year-chart">
              <h3 className="stats-block-title">{p.stats_by_year}</h3>
              <svg
                className="stats-year-chart"
                viewBox={`0 0 ${yearChartWidth} ${yearChartHeight}`}
                role="img"
                aria-label={p.stats_by_year}
              >
                <path className="stats-year-chart-line" d={yearChartPath} />
                {yearChartPoints.map(point => (
                  <g key={point.year}>
                    <text className="stats-year-chart-count" x={point.x} y={Math.max(point.y - 14, 14)} textAnchor="middle">{point.count}</text>
                    <circle className="stats-year-chart-point" cx={point.x} cy={point.y} r="4" />
                    <text className="stats-year-chart-label" x={point.x} y="207" textAnchor="middle">{point.year}</text>
                  </g>
                ))}
              </svg>
            </div>
          )}

        </div>
      )}

      {/* 4. Backlog estimate (full width) */}
      <BacklogEstimate items={items} catalogMap={catalogMap} journey={journey} />

      {/* 5. Activity Heatmap (full width) */}
      <div className="stats-block-custom">
        <h3 className="stats-block-title">{p.stats_heatmap}</h3>
        <div className="stats-heatmap-grid">
          {heatmapData.map(({ date, dateKey, count, level }, idx) => {
            const formattedDate = formatDateShort(date);
            const actStr = count === 1
              ? (p.stats_activity_singular || '{count} actividad').replace('{count}', String(count))
              : (p.stats_activity_plural || '{count} actividades').replace('{count}', String(count));
            const tooltipText = `${formattedDate}: ${actStr}`;
            return <div className={`heatmap-cell level-${level}`} key={`${dateKey}-${idx}`} data-date={dateKey} data-tooltip={tooltipText} />;
          })}
        </div>
        <div className="stats-heatmap-legend">
          <span>{p.heatmap_less}</span>
          <div className="heatmap-legend-cell" style={{ background: 'rgba(255,255,255,0.02)' }} />
          <div className="heatmap-legend-cell" style={{ background: 'color-mix(in srgb, var(--accent) 25%, rgba(255,255,255,0.02))' }} />
          <div className="heatmap-legend-cell" style={{ background: 'color-mix(in srgb, var(--accent) 50%, rgba(255,255,255,0.02))' }} />
          <div className="heatmap-legend-cell" style={{ background: 'color-mix(in srgb, var(--accent) 75%, rgba(255,255,255,0.02))' }} />
          <div className="heatmap-legend-cell" style={{ background: 'var(--accent)', boxShadow: '0 0 4px var(--accent)' }} />
          <span>{p.heatmap_more}</span>
        </div>
      </div>

    </div>
  );
}
