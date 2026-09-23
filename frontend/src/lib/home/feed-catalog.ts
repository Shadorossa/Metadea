// Catalog rows for the activity feed's cards (other people's works, so they
// are rarely in the profile bundle). ActivityFeedSection used to issue one
// get_catalog_entry per card (15 on a full feed) on every mount and again
// on every friends/general tab switch; this reads the ids it hasn't seen
// through ONE get_catalog_entries_by_ids and keeps the rows across mounts,
// so a Home revisit costs nothing here.
//
// get_catalog_entry has one quirk the batch command doesn't: an id whose
// exact row is missing still resolves to the vnovel:/game: sibling with the
// same numeric id (a game reclassified locally as a visual novel keeps its
// feed card). The batch asks for those siblings too and picks per id the
// same way — exact row first, then either sibling.
import { getCatalogEntriesByIds, type CatalogSummary } from '../tauri/catalog';

type Rows = ReadonlyMap<string, CatalogSummary>;

const cached = new Map<string, CatalogSummary | null>();
let inFlight: Promise<void> | null = null;

/** `id` plus the vnovel:/game: siblings sharing its numeric id (none for an
 *  id without a `prefix:number` shape) — exported for tests. */
export function siblingIds(id: string): string[] {
  const colon = id.indexOf(':');
  if (colon === -1) return [id];
  const num = id.slice(colon + 1);
  if (!/^\d+$/.test(num)) return [id];
  return [...new Set([id, `vnovel:${num}`, `game:${num}`])];
}

/** The row get_catalog_entry would have returned for `id` out of a batch
 *  fetched for siblingIds(id): the exact row, else a sibling. Exported for
 *  tests. */
export function pickCatalogRowFor(id: string, rows: Rows): CatalogSummary | null {
  for (const candidate of siblingIds(id)) {
    const row = rows.get(candidate);
    if (row) return row;
  }
  return null;
}

/** Catalog rows for `ids` (missing ids absent), fetched once each. */
export async function readFeedCatalogRows(ids: readonly string[]): Promise<Record<string, CatalogSummary>> {
  const unique = [...new Set(ids)];
  const missing = unique.filter(id => !cached.has(id));
  if (missing.length > 0) {
    // One batch at a time: a second reader arriving mid-flight waits for the
    // first, then fetches only what is still unknown.
    if (inFlight) await inFlight;
    const stillMissing = missing.filter(id => !cached.has(id));
    if (stillMissing.length > 0) {
      const request = [...new Set(stillMissing.flatMap(siblingIds))];
      inFlight = getCatalogEntriesByIds(request)
        .then(rows => {
          const byId = new Map(rows.map(row => [row.external_id, row] as const));
          for (const id of stillMissing) cached.set(id, pickCatalogRowFor(id, byId));
        })
        // A failed batch resolves those ids to "no row" for this read only —
        // nothing is retained, the next read retries.
        .catch(() => {})
        .finally(() => { inFlight = null; });
      await inFlight;
    }
  }
  const out: Record<string, CatalogSummary> = {};
  for (const id of unique) {
    const row = cached.get(id);
    if (row) out[id] = row;
  }
  return out;
}

export function invalidateFeedCatalogRows(): void {
  cached.clear();
}

if (typeof window !== 'undefined') {
  // Cover preferences are folded into the rows at read time, and a library
  // save can create the catalog row a feed id was missing — same events the
  // profile's library-data-cache listens to.
  for (const event of ['refresh-profile-library', 'media-relations-changed', 'media-cover-preference-changed']) {
    window.addEventListener(event, invalidateFeedCatalogRows);
  }
}
