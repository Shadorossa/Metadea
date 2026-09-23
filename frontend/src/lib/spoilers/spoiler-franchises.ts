// Franchises as the spoiler shield sees them: the chains the user follows,
// built from the library rows, the catalog rows and the chain relations the
// profile/home visit cache already holds (lib/profile/library-data-cache.ts)
// — no fetch of its own. Pure — tested in spoiler-franchises.test.ts.
//
// A franchise is one medium's chain: works joined by PREQUEL/SEQUEL (and
// ALTERNATIVE) relations whose types share a medium (on screen / on paper /
// played), so an anime's seasons form one franchise and its source manga
// another. It is *protected* while the user has at least one of its works in
// the library (anything but a dropped row with no progress) and has not
// completed every released one.
import { SEQUEL_RELATION_TYPES, isSagaComponentRelationType } from '../media/saga/saga-relation-types';
import { stripSeasonSuffix } from '../media/mappers/mapper-utils';
import { COMPLETED_STATUS, type ProgressRow } from './spoiler-progress';

export interface SpoilerLibraryRow extends ProgressRow {
  external_id: string;
  type: string;
}

export interface SpoilerCatalogRow {
  external_id: string;
  type: string;
  status?: string | null;
  title_main?: string | null;
  title_romaji?: string | null;
  title_english?: string | null;
  release_year?: number | null;
  release_month?: number | null;
  release_day?: number | null;
  total_count?: number | null;
}

export interface SpoilerRelation {
  media_external_id?: string;
  related_media_external_id: string;
  relation_type: string;
}

export interface SpoilerIndexInput {
  library: readonly SpoilerLibraryRow[];
  catalog: readonly SpoilerCatalogRow[];
  relations: readonly SpoilerRelation[];
  currentYear?: number;
}

export interface SpoilerFranchise {
  /** Smallest member id — stable enough for React keys. */
  id: string;
  /** Members in chain order (prequels first, then release date). */
  memberIds: string[];
  /** The first work's title without its season suffix. */
  name: string;
  /** In the library and not completed — before settings/reveals apply. */
  isProtected: boolean;
  /** Every released member completed. */
  isCompleted: boolean;
}

export interface SpoilerIndex {
  franchiseOf: (id: string) => SpoilerFranchise;
  libraryRow: (id: string) => SpoilerLibraryRow | undefined;
  typeOf: (id: string) => string;
  titleOf: (id: string) => string | null;
  totalCountOf: (id: string) => number | null;
  /** Works the chain puts before `id` (transitively). */
  predecessorsOf: (id: string) => ReadonlySet<string>;
  isStarted: (id: string) => boolean;
  isCompleted: (id: string) => boolean;
}

// Library statuses that mean the user has begun the work even at zero
// progress. `planning` (or no row at all) with nothing consumed has not.
const STARTED_STATUSES = new Set(['watching', 'reading', 'playing', 'paused', 'dropped', COMPLETED_STATUS]);

const MEDIUM_BY_TYPE: Record<string, string> = {
  anime: 'screen', series: 'screen', movie: 'screen',
  manga: 'paper', lnovel: 'paper', book: 'paper', comic: 'paper',
  game: 'played', vnovel: 'played',
};

const UNRELEASED_CATALOG_STATUS = 'NOT_YET_RELEASED';

function typeFromId(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? '' : id.slice(0, colon).split('_')[0];
}

export function mediumOfType(type: string): string {
  return MEDIUM_BY_TYPE[type] ?? type;
}

/** A row the user began: any progress, or a status beyond "planning". */
export function isRowStarted(row: ProgressRow | undefined): boolean {
  if (!row) return false;
  if ((row.progress ?? 0) > 0 || (row.progress_2 ?? 0) > 0) return true;
  return row.status != null && STARTED_STATUSES.has(row.status);
}

/** A row that puts the franchise under protection. */
function isEngagingRow(row: ProgressRow): boolean {
  return !(row.status === 'dropped' && (row.progress ?? 0) <= 0 && (row.progress_2 ?? 0) <= 0);
}

// Which end of a sequel row comes first: (A, B, SEQUEL) means B follows A.
function orderedPair(relation: SpoilerRelation): [string, string] | null {
  const owner = relation.media_external_id;
  if (!owner || !SEQUEL_RELATION_TYPES.has(relation.relation_type)) return null;
  const target = relation.related_media_external_id;
  const isSequel = relation.relation_type === 'SEQUEL' || relation.relation_type === 'SECUELA';
  return isSequel ? [owner, target] : [target, owner];
}

export function buildSpoilerIndex(input: SpoilerIndexInput): SpoilerIndex {
  const currentYear = input.currentYear ?? new Date().getFullYear();
  const libraryById = new Map(input.library.map(row => [row.external_id, row]));
  const catalogById = new Map(input.catalog.map(row => [row.external_id, row]));

  const typeOf = (id: string) => catalogById.get(id)?.type ?? libraryById.get(id)?.type ?? typeFromId(id);

  // Union-find over same-medium chain edges.
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    for (let up = parent.get(root); up !== undefined && up !== root; up = parent.get(root)) root = up;
    let node = id;
    for (let next = parent.get(node); node !== root && next !== undefined; next = parent.get(node)) {
      parent.set(node, root);
      node = next;
    }
    return root;
  };
  const addEdge = (edges: Map<string, Set<string>>, from: string, to: string) => {
    const set = edges.get(from);
    if (set) set.add(to);
    else edges.set(from, new Set([to]));
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA < rootB ? rootB : rootA, rootA < rootB ? rootA : rootB);
  };

  const leaders = new Map<string, Set<string>>();
  for (const relation of input.relations) {
    const owner = relation.media_external_id;
    const target = relation.related_media_external_id;
    if (!owner || !target || owner === target || !isSagaComponentRelationType(relation.relation_type)) continue;
    if (mediumOfType(typeOf(owner)) !== mediumOfType(typeOf(target))) continue;
    union(owner, target);
    const pair = orderedPair(relation);
    if (!pair) continue;
    addEdge(leaders, pair[1], pair[0]);
  }

  const membersByRoot = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const root = find(id);
    const members = membersByRoot.get(root);
    if (members) members.push(id);
    else membersByRoot.set(root, [id]);
  }

  const predecessorCache = new Map<string, Set<string>>();
  const predecessorsOf = (id: string): Set<string> => {
    const cached = predecessorCache.get(id);
    if (cached) return cached;
    const seen = new Set<string>();
    const stack = [...(leaders.get(id) ?? [])];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      if (next === id || seen.has(next)) continue;
      seen.add(next);
      for (const earlier of leaders.get(next) ?? []) stack.push(earlier);
    }
    predecessorCache.set(id, seen);
    return seen;
  };

  const releaseKey = (id: string): number => {
    const row = catalogById.get(id);
    return (row?.release_year ?? 9999) * 10000 + (row?.release_month ?? 12) * 100 + (row?.release_day ?? 31);
  };

  const titleOf = (id: string): string | null => {
    const row = catalogById.get(id);
    return row?.title_main || row?.title_english || row?.title_romaji || null;
  };

  const isCompleted = (id: string) => libraryById.get(id)?.status === COMPLETED_STATUS;

  const isUpcoming = (id: string): boolean => {
    const row = catalogById.get(id);
    if (row?.status === UNRELEASED_CATALOG_STATUS) return true;
    return row?.release_year != null && row.release_year > currentYear;
  };

  const franchiseCache = new Map<string, SpoilerFranchise>();
  const franchiseOf = (id: string): SpoilerFranchise => {
    const root = parent.has(id) ? find(id) : id;
    const cached = franchiseCache.get(root);
    if (cached) return cached;
    const members = membersByRoot.get(root) ?? [id];
    const memberIds = [...members].sort((a, b) =>
      predecessorsOf(a).size - predecessorsOf(b).size || releaseKey(a) - releaseKey(b) || (a < b ? -1 : a > b ? 1 : 0));
    // Members the user can actually complete: known works that are out.
    const countable = memberIds.filter(member => (catalogById.has(member) || libraryById.has(member)) && !isUpcoming(member));
    const rows = memberIds.map(member => libraryById.get(member)).filter((row): row is SpoilerLibraryRow => !!row);
    const completed = countable.length > 0 && countable.every(isCompleted);
    const first = memberIds.find(member => titleOf(member)) ?? memberIds[0];
    const franchise: SpoilerFranchise = {
      id: [...memberIds].sort()[0],
      memberIds,
      name: stripSeasonSuffix(titleOf(first) ?? first),
      isProtected: rows.some(isEngagingRow) && !completed,
      isCompleted: completed,
    };
    franchiseCache.set(root, franchise);
    return franchise;
  };

  return {
    franchiseOf,
    libraryRow: id => libraryById.get(id),
    typeOf,
    titleOf,
    totalCountOf: id => catalogById.get(id)?.total_count ?? null,
    predecessorsOf,
    isStarted: id => isRowStarted(libraryById.get(id)),
    isCompleted,
  };
}

/** Relations implied by an ordered chain (e.g. a saga viewer's season list):
 *  each entry is the SEQUEL of the one before it. */
export function chainToRelations(orderedIds: readonly string[]): SpoilerRelation[] {
  const out: SpoilerRelation[] = [];
  for (let i = 1; i < orderedIds.length; i++) {
    out.push({ media_external_id: orderedIds[i - 1], related_media_external_id: orderedIds[i], relation_type: 'SEQUEL' });
  }
  return out;
}
