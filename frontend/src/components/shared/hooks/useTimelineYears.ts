import { useEffect, useMemo, useState } from 'react';
import { backfillYears, type YearItem } from '../../../lib/media/timeline-years';

/** `items` with missing years filled in once known (lib/media/timeline-years). */
export function useTimelineYears<T extends YearItem>(items: readonly T[]): readonly T[] {
  const [years, setYears] = useState<ReadonlyMap<string, number>>(() => new Map());
  const missingKey = items.filter(item => item.year == null).map(item => item.id).join('|');

  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    void backfillYears(items).then(found => {
      if (!cancelled && found.size > 0) setYears(prev => new Map([...prev, ...found]));
    });
    return () => { cancelled = true; };
    // Keyed by which ids lack a year: a new list with the same gaps doesn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey]);

  return useMemo(
    () => (years.size === 0 ? items : items.map(item => (item.year == null && years.has(item.id) ? { ...item, year: years.get(item.id)! } : item))),
    [items, years],
  );
}
