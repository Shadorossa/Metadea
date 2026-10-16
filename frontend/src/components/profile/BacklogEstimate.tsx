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

const SCOPE_WITH_PROGRESS: readonly BacklogScope[] = ['planning', 'in_progress'];

function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), template);
}

// "How long to clear your backlog?" — pure derivation from what StatsSection
// already fetched (library + catalog + activity journey); no IPC of its own.
export function BacklogEstimate({ items, catalogMap, journey }: Props) {
  const t = getT();
  const b = t.profile.backlog;

  const pace = useMemo(() => estimatePace(journey, catalogMap), [journey, catalogMap]);
  const initialWeeklyHours = Math.max(0.5, Math.round((pace.minutesPerWeek / 60) * 2) / 2);
  const [weeklyHoursInput, setWeeklyHoursInput] = useState(String(initialWeeklyHours));
  const enteredWeeklyHours = Number(weeklyHoursInput);
  const weeklyHours = Number.isFinite(enteredWeeklyHours) && enteredWeeklyHours > 0
    ? Math.min(168, enteredWeeklyHours)
    : initialWeeklyHours;
  const minutesPerWeek = weeklyHours * 60;
  const estimate = useMemo(
    () => estimateBacklog(items, catalogMap, { scope: SCOPE_WITH_PROGRESS }),
    [items, catalogMap],
  );

  const now = new Date();
  const { total, byType } = estimate;
  const totalWeeks = total.remainingMinutes / minutesPerWeek;
  const finishDate = estimateFinishDate(now, total.remainingMinutes, minutesPerWeek);
  const headlineDuration = formatDuration(totalWeeks * 7 * 24 * 60, t);
  const paceScale = minutesPerWeek / pace.minutesPerWeek;

  const typeRows = byType.map(row => {
    const typePace = (pace.byType[row.type] ?? pace.minutesPerWeek) * paceScale;
    const eta = estimateFinishDate(now, row.remainingMinutes, typePace);
    return {
      ...row,
      label: getTypeLabel(row.type),
      hours: fill(b.hours_short, { hours: Math.round(row.remainingMinutes / 60) }),
      eta: eta ? formatDateShort(eta) : b.never,
      confidenceTitle: row.lowConfidence
        ? fill(b.low_confidence, { count: row.missingDataCount, total: row.pendingCount })
        : undefined,
    };
  });

  return (
    <div className="stats-block-custom">
      {total.pendingCount === 0 ? (
        <p className="stats-backlog-empty">{b.empty}</p>
      ) : (
        <>
          <div className="stats-backlog-summary-row">
            <p className="stats-backlog-headline">
              {fill(b.headline, { duration: '\u0000' }).split('\u0000').map((chunk, i) => (
                i === 0 ? <span key="pre">{chunk}<strong>{headlineDuration}</strong></span> : <span key="post">{chunk}</span>
              ))}
              {finishDate && <span className="stats-backlog-date">{fill(b.headline_date, { date: formatDateShort(finishDate) })}</span>}
            </p>
            <label className="stats-backlog-hours-control">
              {b.weekly_hours} (
              <input
                type="number"
                min="0.5"
                max="168"
                step="0.5"
                value={weeklyHoursInput}
                aria-label={b.weekly_hours}
                onChange={e => setWeeklyHoursInput(e.target.value)}
              />
              {' '}{b.hours_per_week_short})
            </label>
          </div>
          <div className="stats-backlog-table-scroll">
            <div
              className="stats-backlog-table"
              role="table"
              style={{
                gridTemplateColumns: `minmax(112px, 1.2fr) repeat(${typeRows.length}, minmax(82px, 1fr))`,
                minWidth: `${112 + typeRows.length * 82}px`,
              }}
            >
              <div className="stats-backlog-row stats-backlog-row--head" role="row">
                <span role="columnheader">{b.col_section}</span>
                {typeRows.map(row => (
                  <span role="columnheader" className="stats-backlog-media" key={row.type}>
                    {row.label}
                    {row.lowConfidence && <span className="stats-backlog-flag" title={row.confidenceTitle}>≈</span>}
                  </span>
                ))}
              </div>
              {[
                { label: b.col_count, value: (row: typeof typeRows[number]) => row.pendingCount },
                { label: b.col_hours, value: (row: typeof typeRows[number]) => row.hours },
                { label: b.col_eta, value: (row: typeof typeRows[number]) => row.eta },
              ].map(metric => (
                <div className="stats-backlog-row" role="row" key={metric.label}>
                  <span role="rowheader" className="stats-backlog-type">{metric.label}</span>
                  {typeRows.map(row => (
                    <span role="cell" className="stats-backlog-cell" key={row.type}>{metric.value(row)}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>

        </>
      )}
    </div>
  );
}
