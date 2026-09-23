// The exclusions Search applies to what it lists, shared with every other
// list of works that must agree with it (the company page's grid, timeline
// and completion bar). IGDB's category/edition rules and TMDB's Japanese
// animation rule run in Rust before the rows reach the frontend
// (src-tauri/src/igdb/mapping.rs plain_search_verdict, company_catalog/
// tmdb.rs); everything decided client-side lives here.
import { getBlockedExternalIds, getReclassifiedExternalIds } from '../tauri/catalog';
import { isAdultContentEnabled } from '../storage/preferences';

/** What a list does with a work: show it, keep it behind an "include DLC"
 *  style toggle (Search, which has none, drops it), or drop it. */
export type ExclusionVerdict = 'keep' | 'extra' | 'exclude';

// Same "not its own search hit" formats igdb_search excludes on the live
// side (Rust, igdb/mapping.rs) — a local catalog row can carry one of these
// (e.g. synced from the community catalog, or fetched before format
// tracking existed) and without this it'd reappear even though the live
// path was specifically made to hide it.
export const EXCLUDED_LOCAL_FORMATS: ReadonlySet<string> = new Set([
  'REMASTER', 'EXPANDED_GAME', 'UPDATE', 'DLC', 'MOD', 'PORT', 'FORK', 'BUNDLE',
]);

// The excluded formats a list with its own DLC toggle keeps as extras.
const EXTRA_LOCAL_FORMATS: ReadonlySet<string> = new Set(['DLC', 'MOD', 'BUNDLE', 'UPDATE']);

// Whole-word match only — mirrors name_has_edition_word in igdb/mapping.rs
// (same word list) so "Expedition 33" isn't caught by a plain "edition"
// substring check. Catches a locally-cataloged remaster/expanded-edition/
// DLC whose own `format` column is missing or wrong.
const NON_GAME_NAME_WORDS = ['edition', 'remaster', 'remastered', 'dlc'];

export function titleHasEditionWord(title: string): boolean {
  return title.split(/[^a-zA-Z0-9]+/).some(tok => NON_GAME_NAME_WORDS.includes(tok.toLowerCase()));
}

/** Search's local-catalog rules for one row: excluded formats, and for
 *  games / visual novels, "... Edition"-style titles. */
export function localCatalogVerdict(row: { type: string; format?: string | null; title?: string | null }): ExclusionVerdict {
  if (row.format && EXCLUDED_LOCAL_FORMATS.has(row.format)) {
    return EXTRA_LOCAL_FORMATS.has(row.format) ? 'extra' : 'exclude';
  }
  if ((row.type === 'game' || row.type === 'vnovel') && titleHasEditionWord(row.title || '')) return 'exclude';
  return 'keep';
}

/** AniList's `isAdult` query variable: false to hide adult works, or
 *  undefined (dropped from the request JSON) when the user shows them.
 *  Never null: AniList reads an explicit `isAdult: null` as a filter that
 *  matches nothing, so every search came back empty with adult content on. */
export function aniListAdultVariable(showAdult: boolean = isAdultContentEnabled()): false | undefined {
  return showAdult ? undefined : false;
}

/** Client-side twin of aniListAdultVariable for rows that carry the flag. */
export function isHiddenAdult(isAdult: boolean | null | undefined, showAdult: boolean = isAdultContentEnabled()): boolean {
  return !!isAdult && !showAdult;
}

/** game/vnovel share IGDB's id space: only those can be reclassified. */
export function reclassifiableIds<T>(items: readonly T[], typeOf: (item: T) => string, idOf: (item: T) => string): string[] {
  return items.filter(item => {
    const type = typeOf(item);
    return type === 'game' || type === 'vnovel';
  }).map(idOf);
}

/** Drops the items whose id is in any of the sets. */
export function withoutIds<T>(items: readonly T[], idOf: (item: T) => string, ...sets: ReadonlySet<string>[]): T[] {
  const active = sets.filter(set => set.size > 0);
  if (active.length === 0) return [...items];
  return items.filter(item => {
    const id = idOf(item);
    return !active.some(set => set.has(id));
  });
}

// search_catalog (Rust) already excludes blocked_at rows for the local-
// catalog half of a result — but a live API hit for that same title has no
// idea it was blocked locally, so it'd still show up on its own.
export async function readBlockedIds(): Promise<Set<string>> {
  return new Set(await getBlockedExternalIds().catch(() => [] as string[]));
}

// A work reclassified locally from game to vnovel (or back) doesn't need an
// explicit block to stop showing under its old type: the live API (which
// has no idea we split IGDB's games into two buckets) still returns it
// there, but the local catalog filing it under the other type is signal
// enough on its own.
export async function readReclassifiedIds(candidateIds: readonly string[]): Promise<Set<string>> {
  if (candidateIds.length === 0) return new Set();
  return new Set(await getReclassifiedExternalIds([...candidateIds]).catch(() => [] as string[]));
}
