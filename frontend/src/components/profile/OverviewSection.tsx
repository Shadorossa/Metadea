// The profile's Overview tab — Hall of Fame, the stats row, monthly history
// and recent activity — rendered from injected data so the owner's /profile
// (mount/render-overview.ts, local tables) and someone else's /user page
// (UserProfileView, the synced social_user_* cache) share one layout.
// readOnly hides the owner-only affordances (the activity delete menu).
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CatalogSummary, CharacterEntry, DayJourney, DbMediaRelation, FavoriteCustomImage, LibraryEntry } from '../../lib/tauri';
import { getT } from '../../i18n/runtime';
import { pad, typeLabel } from '../../lib/profile/media-type-label';
import { formatAverageScore, type RatingSystem } from '../../lib/media/rating-utils';
import { computeOverviewAggregate, getItemMinutes } from '../../lib/profile/stats-calculators';
import { buildMonthlyHistoryHtml, initMonthlyHistoryListeners } from '../../lib/profile/monthly';
import { ICON_MH_MEDIA, ICON_MH_CHARACTER } from '../../lib/dom/icon-strings';
import { HofSection } from './HofSection';
import { ActivitySection } from './ActivitySection';
import { CharacterReactionsPanel } from './CharacterReactionsPanel';
import { emptyCharacterReactionGroups, type CharacterReactionGroups } from '../../lib/character/character-reactions';

export interface OverviewData {
  items: LibraryEntry[];
  catalogMap: Map<string, CatalogSummary>;
  /** "YYYY-MM" → ordered external ids (the first is the month's headline). */
  monthlyHistory: Record<string, string[]>;
  system: RatingSystem;
  /** Hall of Fame picks — { multimedia: string[], character: string[], … }. */
  favorites: Record<string, string[]>;
  characterMap: Map<string, CharacterEntry>;
  /** Local-only cover crops from the Favorites tab's image editor. */
  customImageMap?: Map<string, FavoriteCustomImage>;
  /** Disk-cached covers (lib/profile/cover-cache.ts), preferred over the CDN. */
  coverPathById?: ReadonlyMap<string, string>;
  journey: DayJourney[];
  /** Collapses anime/series seasons into one work in the counts. */
  sagaRelations: DbMediaRelation[];
  /** Like / interested / dislike character lists (the monthly history's
   *  character view). Absent = none. */
  characterReactions?: CharacterReactionGroups;
}

const NO_REACTIONS = emptyCharacterReactionGroups();

/** Ids whose covers the overview paints from plain props / HTML (Hall of
 *  Fame + each month's headline) — resolve these against the cover cache. */
export function overviewCoverIds(favorites: Record<string, string[]>, monthlyHistory: Record<string, string[]>): string[] {
  const monthlyHeadlineIds = Object.values(monthlyHistory).map(ids => ids?.[0]).filter((id): id is string => !!id);
  return [...(favorites.multimedia ?? []), ...monthlyHeadlineIds];
}

function StatsBar({ data }: { data: OverviewData }) {
  const t = getT();
  const p = t.profile;
  const formats = t.media.formats as Record<string, string>;
  const { items, catalogMap, sagaRelations, system } = data;

  const summary = useMemo(() => {
    // Single source of truth for every "how many works" count, shared with
    // the Stats tab (saga seasons collapse into one work).
    const aggregate = computeOverviewAggregate(items, catalogMap, sagaRelations);
    // Hours DO include sub-work time — each logged version/season/issue is
    // real time spent.
    let totalMinutes = 0;
    for (const item of items) totalMinutes += getItemMinutes(item, catalogMap);
    return { ...aggregate, totalHours: Math.round(totalMinutes / 60) };
  }, [items, catalogMap, sagaRelations]);

  const avg = summary.avgScore > 0 ? formatAverageScore(summary.avgScore, system) : '0.0';
  const completedByType = Object.entries(summary.completedByType);
  const completedTooltip = (
    <span className="stat-help-wrap">
      <span className="stat-help-icon">?</span>
      <span className="stat-tooltip">
        {completedByType.length > 0 ? completedByType.map(([type, count]) => (
          <Fragment key={type}>
            <span className="stat-tooltip-row">
              <span className="stat-tooltip-label">{typeLabel(type)}</span>
              <span className="stat-tooltip-value">{count}</span>
            </span>
            {Object.entries(summary.completedSubBreakdownByType[type] ?? {}).map(([format, subCount]) => (
              <span className="stat-tooltip-row stat-tooltip-row--sub" key={format}>
                <span className="stat-tooltip-label">{formats[format] ?? format}</span>
                <span className="stat-tooltip-value">{subCount}</span>
              </span>
            ))}
          </Fragment>
        )) : (
          <span className="stat-tooltip-row"><span className="stat-tooltip-label">{p.stat_none}</span></span>
        )}
      </span>
    </span>
  );

  const stats: Array<{ label: string; value: string; tooltip?: boolean }> = [
    { label: p.stat_total, value: pad(summary.totalWorks) },
    { label: p.stat_progress, value: pad(summary.currently) },
    { label: p.stat_completed, value: pad(summary.completed), tooltip: true },
    { label: p.stat_pending, value: pad(summary.planning) },
    { label: p.stat_dropped, value: pad(summary.dropped) },
    { label: p.stat_avg, value: avg },
    { label: p.stat_hours, value: `${summary.totalHours}h` },
  ];

  return (
    <div className="profile-stats-bar">
      {stats.map(stat => (
        <div className="profile-stat" key={stat.label}>
          <span className="profile-stat-value">{stat.value}</span>
          <span className="profile-stat-label">
            {stat.label}
            {stat.tooltip && completedTooltip}
          </span>
        </div>
      ))}
    </div>
  );
}

function MonthlyHistory({ data }: { data: OverviewData }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const html = useMemo(
    () => buildMonthlyHistoryHtml(data.monthlyHistory, data.items, data.catalogMap, data.coverPathById),
    [data.monthlyHistory, data.items, data.catalogMap, data.coverPathById],
  );
  useLayoutEffect(() => {
    const monthly = hostRef.current?.querySelector<HTMLElement>('.monthly-history');
    if (monthly) initMonthlyHistoryListeners(monthly);
  }, [html]);
  return <div className="profile-monthly-host" ref={hostRef} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function OverviewSection({ data, readOnly }: { data: OverviewData; readOnly?: boolean }) {
  const p = getT().profile;
  const { items, catalogMap, favorites } = data;
  const [monthlyView, setMonthlyView] = useState<'media' | 'character'>('media');

  const hofItems = useMemo(() => {
    const byId = new Map(items.map(item => [item.external_id, item]));
    return (favorites.multimedia ?? []).map(id => {
      const local = byId.get(id);
      if (local) return local;
      const meta = catalogMap.get(id);
      // Synthetic partial entry — the Hall of Fame only reads external_id/type
      // off it (the rest comes from catalogMap).
      if (meta) return { external_id: id, type: meta.type } as Partial<LibraryEntry> as LibraryEntry;
      return null;
    }).filter((item): item is LibraryEntry => item !== null);
  }, [items, catalogMap, favorites]);

  return (
    <>
      <HofSection
        items={hofItems}
        catalogMap={catalogMap}
        p={p}
        charFavIds={favorites.character ?? []}
        characterMap={data.characterMap}
        customImageMap={data.customImageMap}
        coverPathById={data.coverPathById}
      />
      <StatsBar data={data} />
      <div className="profile-bottom-grid">
        <div className="profile-bottom-col">
          <div className="profile-section-header">
            <p className="profile-section-label">{p.monthly_history}</p>
            <div className="mh-view-toggle">
              <button
                type="button"
                className={`mh-view-btn${monthlyView === 'media' ? ' active' : ''}`}
                data-view="media"
                title={p.lists_type_media}
                aria-pressed={monthlyView === 'media'}
                onClick={() => setMonthlyView('media')}
                dangerouslySetInnerHTML={{ __html: ICON_MH_MEDIA }}
              />
              <span className="mh-view-toggle-divider"></span>
              <button
                type="button"
                className={`mh-view-btn${monthlyView === 'character' ? ' active' : ''}`}
                data-view="character"
                title={p.monthly_view_characters}
                aria-pressed={monthlyView === 'character'}
                onClick={() => setMonthlyView('character')}
                dangerouslySetInnerHTML={{ __html: ICON_MH_CHARACTER }}
              />
            </div>
            <div className="profile-section-line"></div>
          </div>
          {monthlyView === 'media'
            ? <MonthlyHistory data={data} />
            : <CharacterReactionsPanel reactions={data.characterReactions ?? NO_REACTIONS} readOnly={readOnly} />}
        </div>
        <div className="profile-bottom-col">
          <div className="profile-section-header">
            <p className="profile-section-label">{p.recent_activity}</p>
            <div className="profile-section-line"></div>
          </div>
          <ActivitySection catalogMap={catalogMap} p={p} overrideJourney={data.journey} readOnly={readOnly} />
        </div>
      </div>
    </>
  );
}
