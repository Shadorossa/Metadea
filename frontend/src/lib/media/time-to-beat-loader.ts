// One in-flight/settled lookup per work for the whole session, so the media
// page and the Local detail panel (and re-opening either) share a single
// IPC round trip; the Rust side keeps the durable 30-day cache.
import { getTimeToBeat, type TimeToBeat, type TimeToBeatQuery } from '../tauri/time-to-beat';

const lookups = new Map<string, Promise<TimeToBeat | null>>();

export function loadTimeToBeat(query: TimeToBeatQuery): Promise<TimeToBeat | null> {
  const known = lookups.get(query.externalId);
  if (known) return known;
  const lookup = getTimeToBeat([query])
    .then(rows => rows.find(row => row.externalId === query.externalId) ?? null)
    .catch(() => null);
  lookups.set(query.externalId, lookup);
  return lookup;
}
