import { useEffect, useMemo, useState } from 'react';
import type { Translations } from '../../../i18n/index';
import type { SagaEntry } from '../../../lib/anilist/saga';
import { getCachedLibraryAndCatalog, type LibraryAndCatalog } from '../../../lib/profile/library-data-cache';
import {
  computeSagaCompletion,
  describeTypeBreakdown,
  isSagaCompletionVisible,
  pickHeadline,
} from '../../../lib/media/saga/saga-completion';
import { interpolate } from '../../../lib/shared/text/interpolate';

interface Props {
  /** The viewer's own panels — alternative editions already share one panel. */
  members: SagaEntry[][];
  i18n: Translations['media'];
}

// Compact "how much of this saga have you finished" meter that sits above
// the saga strip. Reads the same cached library/catalog bundle the profile
// views share (one IPC round trip per session, not per open), so it adds no
// fetch of its own; hidden entirely until the user is past 1 % of the saga.
export function SagaCompletionBar({ members, i18n }: Props) {
  const strings = i18n.saga_completion;
  const [data, setData] = useState<LibraryAndCatalog | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCachedLibraryAndCatalog()
      .then(loaded => { if (!cancelled) setData(loaded); })
      .catch(() => { /* read-only: no bar is already what the UI shows for "unknown" */ });
    return () => { cancelled = true; };
  }, []);

  const membersKey = members.map(panel => panel.map(entry => entry.externalId).join('|')).join(',');
  const result = useMemo(() => {
    if (!data) return null;
    const libraryById = new Map(data.items.map(row => [row.external_id, row]));
    const catalogById = new Map(data.catalog.map(row => [row.external_id, row]));
    return computeSagaCompletion(members, libraryById, catalogById);
    // membersKey stands in for `members`: the viewer rebuilds the panel arrays
    // on every render, but only their ids matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, membersKey]);

  if (!result || !isSagaCompletionVisible(result)) return null;

  const breakdown = describeTypeBreakdown(result, strings);
  const upcoming = result.upcomingCount > 0
    ? interpolate(strings.upcoming_not_counted, { count: result.upcomingCount })
    : null;

  return (
    <div className="saga-completion" role="group" aria-label={strings.label}>
      <div className="saga-completion-row">
        <span className="saga-completion-headline">{pickHeadline(result, strings)}</span>
        <span className="saga-completion-percent">{result.weightedPercent} %</span>
      </div>
      <div
        className="saga-completion-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={result.weightedPercent}
      >
        <div className="saga-completion-fill" style={{ width: `${result.weightedPercent}%` }} />
      </div>
      <div className="saga-completion-tooltip" role="tooltip">
        {breakdown.map(line => <span key={line}>{line}</span>)}
        {upcoming && <span className="saga-completion-tooltip-upcoming">{upcoming}</span>}
      </div>
    </div>
  );
}
