// Career timelines (company + author pages) place each work by its year, but
// the provider list a page was built from often lacks one — and the cached
// list never learns it, even after the work's own page was opened (which
// wrote its release_year to the local catalog). This fills the gaps at read
// time: first from the local catalog, then — for AniList works still
// missing one — from one batched AniList query per 50 ids. Answers
// (including "no year") are remembered for the session.
import { getCatalogEntriesByIds } from '../tauri/catalog';
import { anilistPost } from '../search/providers/anilist/client';

export interface YearItem { id: string; year: number | null }

export interface YearSources {
  catalogYears: (ids: string[]) => Promise<Map<string, number>>;
  anilistYears: (numericIds: number[]) => Promise<Map<number, number>>;
}

const known = new Map<string, number | null>();

const ANILIST_BATCH = 50;
const ANILIST_ID = /^(?:anime|manga|lnovel):(\d+)$/;

const defaultSources: YearSources = {
  async catalogYears(ids) {
    const rows = await getCatalogEntriesByIds(ids).catch(() => []);
    const out = new Map<string, number>();
    for (const row of rows) if (row.release_year) out.set(row.external_id, row.release_year);
    return out;
  },
  async anilistYears(numericIds) {
    const out = new Map<number, number>();
    for (let i = 0; i < numericIds.length; i += ANILIST_BATCH) {
      const chunk = numericIds.slice(i, i + ANILIST_BATCH);
      const data = await anilistPost<{ Page?: { media?: Array<{ id: number; startDate?: { year?: number | null } | null }> } }>(
        'query ($ids: [Int]) { Page(perPage: 50) { media(id_in: $ids) { id startDate { year } } } }',
        { ids: chunk },
      );
      for (const media of data?.Page?.media ?? []) {
        if (media.startDate?.year) out.set(media.id, media.startDate.year);
      }
    }
    return out;
  },
};

/** Years for the items that have none, as `id → year` (only found ones). */
export async function backfillYears(items: readonly YearItem[], sources: YearSources = defaultSources): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  const missing: string[] = [];
  for (const item of items) {
    if (item.year != null) continue;
    const cached = known.get(item.id);
    if (cached != null) found.set(item.id, cached);
    else if (cached === undefined) missing.push(item.id);
  }
  if (missing.length === 0) return found;

  const fromCatalog = await sources.catalogYears(missing);
  const stillMissing: string[] = [];
  for (const id of missing) {
    const year = fromCatalog.get(id);
    if (year) { found.set(id, year); known.set(id, year); } else stillMissing.push(id);
  }

  const numeric = new Map<number, string>();
  for (const id of stillMissing) {
    const match = ANILIST_ID.exec(id);
    if (match) numeric.set(Number(match[1]), id);
    else known.set(id, null);
  }
  if (numeric.size > 0) {
    const fromAniList = await sources.anilistYears([...numeric.keys()]).catch(() => new Map<number, number>());
    for (const [numericId, id] of numeric) {
      const year = fromAniList.get(numericId);
      if (year) { found.set(id, year); known.set(id, year); } else known.set(id, null);
    }
  }
  return found;
}

/** Test hook: forget the session answers. */
export function resetBackfilledYears(): void {
  known.clear();
}
