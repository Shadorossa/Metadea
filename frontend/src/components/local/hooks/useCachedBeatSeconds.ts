import { useEffect, useState } from 'react';
import { getCachedTimeToBeat } from '../../../lib/tauri/time-to-beat';
import { shortestBeatSeconds } from '../../../lib/media/time-to-beat';

const EMPTY: ReadonlyMap<string, number> = new Map();

// Lengths for the "Shortest to beat" sort, read from the time_to_beat cache
// in one IPC call — never a request per game: only works whose detail block
// already looked their length up are known, the rest sort last. Idle (and
// empty) while another sort is selected.
export function useCachedBeatSeconds(enabled: boolean, externalIds: readonly string[]): ReadonlyMap<string, number> {
  const [lengths, setLengths] = useState<ReadonlyMap<string, number>>(EMPTY);
  const idsKey = enabled ? [...new Set(externalIds)].sort().join('\n') : '';

  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    getCachedTimeToBeat(idsKey.split('\n')).then(rows => {
      if (cancelled) return;
      const next = new Map<string, number>();
      for (const row of rows) {
        const seconds = shortestBeatSeconds(row);
        if (seconds) next.set(row.externalId, seconds);
      }
      setLengths(next);
    });
    return () => { cancelled = true; };
  }, [idsKey]);

  return enabled ? lengths : EMPTY;
}
