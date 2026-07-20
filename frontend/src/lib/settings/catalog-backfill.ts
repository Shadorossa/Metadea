// One-off maintenance sweep for existing catalog rows that predate this
// session's new persisted fields (country_code, release_end_year/month/day,
// title_english) — those only ever get filled in by a live fetch, which
// most rows won't get again for a while (needsResync()'s normal cadence), so
// without this they'd just stay blank indefinitely. Triggered manually from
// CatalogAdminPanel rather than run automatically, since it means one live
// API call per entry that's missing something.
import { getAllCatalogEntries, getCatalogEntry, type MediaCatalogEntry } from '../tauri/catalog';
import { fetchMediaData } from '../media/mediaService';

const BACKFILL_FIELDS = [
  ['country_code', 'País de origen'],
  ['release_end_year', 'Año de fin'],
  ['release_end_month', 'Mes de fin'],
  ['release_end_day', 'Día de fin'],
  ['title_english', 'Título en inglés'],
] as const;

type BackfillField = typeof BACKFILL_FIELDS[number][0];

export interface BackfillEntryResult {
  externalId: string;
  titleMain: string;
  // Every field this sweep looked at, whichever way it went — the UI dims
  // the ones that didn't change and highlights the ones that did, rather
  // than only listing changes (a field staying null because the live
  // provider genuinely has nothing for it is still useful to see).
  fields: { field: BackfillField; label: string; before: unknown; after: unknown; changed: boolean }[];
}

export interface BackfillProgress {
  done: number;
  total: number;
  current: string; // title of the entry just processed
}

// Only worth a live re-fetch when at least one of the new fields is still
// empty — an entry that's already been visited since these fields existed
// has nothing to backfill.
function isMissingBackfillData(entry: MediaCatalogEntry): boolean {
  return BACKFILL_FIELDS.some(([field]) => entry[field] == null);
}

export async function backfillMissingCatalogFields(
  onProgress?: (progress: BackfillProgress) => void,
): Promise<BackfillEntryResult[]> {
  const entries = await getAllCatalogEntries();
  const candidates = entries.filter(isMissingBackfillData);
  const results: BackfillEntryResult[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const before = candidates[i];
    onProgress?.({ done: i, total: candidates.length, current: before.title_main || before.external_id });

    await fetchMediaData(before.external_id).catch(() => null);
    const after = await getCatalogEntry(before.external_id).catch(() => null);
    if (after) {
      const fields = BACKFILL_FIELDS.map(([field, label]) => ({
        field,
        label,
        before: before[field] ?? null,
        after: after[field] ?? null,
        changed: (before[field] ?? null) !== (after[field] ?? null),
      }));
      if (fields.some(f => f.changed)) {
        results.push({ externalId: before.external_id, titleMain: after.title_main || before.external_id, fields });
      }
    }
  }

  onProgress?.({ done: candidates.length, total: candidates.length, current: '' });
  return results;
}
