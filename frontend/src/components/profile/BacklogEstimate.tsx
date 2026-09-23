import { useMemo, useState } from 'react';
import type { CatalogSummary, DayJourney, LibraryEntry } from '../../lib/tauri';
import { getT } from '../../i18n/runtime';
import { getTypeLabel } from '../../lib/media/media-types';
import { formatDateShort } from '../../lib/shared/text/format-date';
import {
  estimateBacklog,
  estimatePace,
  estimateFinishDate,
  formatDuration,
  type BacklogScope,
} from '../../lib/profile/backlog-estimate';

interface Props {
  items: LibraryEntry[];
  catalogMap: Map<string, CatalogSummary>;
  journey: DayJourney[];
}

const SCOPE_PLANNING: readonly BacklogScope[] = ['planning'];
const SCOPE_WITH_PROGRESS: readonly BacklogScope[] = ['planning', 'in_progress'];

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), template);
}

// "How long to clear your backlog?" — pure derivation from what StatsSection
// already fetched (library + catalog + activity journey); no IPC of its own.
export function BacklogEstimate({ items, catalogMap, journey }: Props) {
  const t = getT();
  const b = t.profile.backlog;
  const [includeInProgress, setIncludeInProgress] = useState(true);

  const pace = useMemo(() => estimatePace(journey, catalogMap), [journey, catalogMap]);
  const estimate = useMemo(
    () => estimateBacklog(items, catalogMap, { scope: includeInProgress ? SCOPE_WITH_PROGRESS : SCOPE_PLANNING }),
    [items, catalogMap, includeInProgress],
  );

  const now = new Date();
  const { total, byType } = estimate;
  const totalWeeks = total.remainingMinutes / pace.minutesPerWeek;
  const finishDate = estimateFinishDate(now, total.remainingMinutes, pace.minutesPerWeek);
  const headlineDuration = formatDuration(totalWeeks * 7 * 24 * 60, t);
  const paceHours = (pace.minutesPerWeek / 60).toFixed(pace.minutesPerWeek % 60 === 0 ? 0 : 1);
  const paceLine = pace.weeks > 0
    ? fill(b.pace, { hours: paceHours, weeks: pace.weeks })
    : fill(b.pace_default, { hours: paceHours });

  const scopeButtons: { label: string; active: boolean; onClick: () => void }[] = [
    { label: b.scope_planning, active: !includeInProgress, onClick: () => setIncludeInProgress(false) },
    { label: b.scope_with_progress, active: includeInProgress, onClick: () => setIncludeInProgress(true) },
  ];

  return (
    <div className="stats-block-custom">
      <div className="stats-backlog-head">
        <h3 className="stats-block-title" title={b.tooltip}>{b.title}</h3>
        <div className="stats-backlog-scope" role="group">
          {scopeButtons.map(btn => (
            <button
              key={btn.label}
              type="button"
              className={`stats-backlog-scope-btn${btn.active ? ' active' : ''}`}
              aria-pressed={btn.active}
              onClick={btn.onClick}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {total.pendingCount === 0 ? (
        <p className="stats-backlog-empty">{b.empty}</p>
      ) : (
        <>
          <p className="stats-backlog-headline">
            {fill(b.headline, { duration: '\u0000' }).split('\u0000').map((chunk, i) => (
              i === 0 ? <span key="pre">{chunk}<strong>{headlineDuration}</strong></span> : <span key="post">{chunk}</span>
            ))}
            {finishDate && <span className="stats-backlog-date">{fill(b.headline_date, { date: formatDateShort(finishDate) })}</span>}
          </p>
          <p className="stats-backlog-pace">{paceLine}</p>

          <div className="stats-backlog-table" role="table">
            <div className="stats-backlog-row stats-backlog-row--head" role="row">
              <span role="columnheader">{b.col_type}</span>
              <span role="columnheader">{b.col_count}</span>
              <span role="columnheader">{b.col_hours}</span>
              <span role="columnheader">{b.col_eta}</span>
            </div>
            {byType.map(row => {
              const typePace = pace.byType[row.type] ?? pace.minutesPerWeek;
              const eta = estimateFinishDate(now, row.remainingMinutes, typePace);
              return (
                <div className="stats-backlog-row" role="row" key={row.type}>
                  <span role="cell" className="stats-backlog-type">
                    {getTypeLabel(row.type)}
                    {row.lowConfidence && <span className="stats-backlog-flag" title={fill(b.low_confidence, { count: row.missingDataCount, total: row.pendingCount })}>≈</span>}
                  </span>
                  <span role="cell">{row.pendingCount}</span>
                  <span role="cell">{fill(b.hours_short, { hours: Math.round(row.remainingMinutes / 60) })}</span>
                  <span role="cell">{eta ? formatDateShort(eta) : b.never}</span>
                </div>
              );
            })}
          </div>

          {(total.lowConfidence || pace.lowConfidence) && (
            <p className="stats-backlog-hint">
              {total.lowConfidence
                ? fill(b.low_confidence, { count: total.missingDataCount, total: total.pendingCount })
                : paceLine}
            </p>
          )}
        </>
      )}
    </div>
  );
}
