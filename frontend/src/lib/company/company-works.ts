// Filtering and sorting of a company page's works grid. Pure: the page
// passes the user's per-work state (lib/media/creator-completion.ts) in.
import type { CompanyRole, CompanyWork } from '../tauri/company-catalog';
import type { WorkLibraryState } from '../media/creator-completion';
import { isMasterpiece } from '../media/career-timeline';
import { isHiddenAdult, localCatalogVerdict, withoutIds } from '../search/exclusion-filters';

export type CompanyRoleFilter = 'all' | 'developed' | 'published';
export type CompanyWorkSort = 'year' | 'title' | 'status';

export interface CompanyWorkFilters {
  role: CompanyRoleFilter;
  /** A media type (`game`, `anime`, ...) or `all`. */
  type: string;
  sort: CompanyWorkSort;
  onlyMissing: boolean;
  includeExtras: boolean;
  /** Only works scored 8+ (lib/media/career-timeline.ts). */
  masterpiecesOnly: boolean;
}

export const DEFAULT_COMPANY_WORK_FILTERS: CompanyWorkFilters = {
  role: 'all',
  type: 'all',
  sort: 'year',
  onlyMissing: false,
  includeExtras: false,
  masterpiecesOnly: false,
};

// "Made it" vs "put it out": a studio / production company is on the
// developed side, a producer / network on the published side.
const DEVELOPED_ROLES: readonly CompanyRole[] = ['developer', 'studio', 'production'];
const PUBLISHED_ROLES: readonly CompanyRole[] = ['publisher', 'producer', 'network'];

function matchesRole(work: CompanyWork, role: CompanyRoleFilter): boolean {
  if (role === 'all') return true;
  const wanted = role === 'developed' ? DEVELOPED_ROLES : PUBLISHED_ROLES;
  return work.roles.some(r => wanted.includes(r));
}

/** Whether the role filter means anything: some works sit on each side. */
export function hasRoleSplit(works: readonly CompanyWork[]): boolean {
  return works.some(w => matchesRole(w, 'developed')) && works.some(w => matchesRole(w, 'published'));
}

/** Media types present, most frequent first. */
export function availableTypes(works: readonly CompanyWork[]): string[] {
  const counts = new Map<string, number>();
  for (const work of works) counts.set(work.media_type, (counts.get(work.media_type) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type]) => type);
}

export function hasExtras(works: readonly CompanyWork[]): boolean {
  return works.some(w => w.is_extra);
}

export function hasMasterpieces(works: readonly CompanyWork[]): boolean {
  return works.some(w => isMasterpiece(w.score));
}

export interface CompanyExclusionContext {
  /** Blocked catalog entries (readBlockedIds). */
  blocked: ReadonlySet<string>;
  /** game/vnovel ids filed locally under the other type (readReclassifiedIds). */
  reclassified: ReadonlySet<string>;
  showAdult: boolean;
  /** The page's source: `local` rows also get search's local-catalog rules. */
  source: string;
}

/** The exclusions Search applies (lib/search/exclusion-filters.ts), run
 *  over the works before anything counts or shows them, so the grid, the
 *  timeline and the completion bar agree with Search. What Search drops as
 *  DLC / bundles stays as an extra, behind the page's own toggle. The
 *  provider-side rules (IGDB categories and editions, TMDB's Japanese
 *  animation) already ran in Rust. */
export function applySearchExclusions(works: readonly CompanyWork[], context: CompanyExclusionContext): CompanyWork[] {
  const kept: CompanyWork[] = [];
  for (const work of withoutIds(works, w => w.external_id, context.blocked, context.reclassified)) {
    if (isHiddenAdult(work.is_adult, context.showAdult)) continue;
    if (context.source === 'local') {
      const verdict = localCatalogVerdict({ type: work.media_type, format: work.format, title: work.title });
      if (verdict === 'exclude') continue;
      if (verdict === 'extra' && !work.is_extra) {
        kept.push({ ...work, is_extra: true });
        continue;
      }
    }
    kept.push(work);
  }
  return kept;
}

// "Your status" order: what you are playing/watching now first, then what
// you finished, then what is planned, then the rest.
const STATE_ORDER: Record<WorkLibraryState, number> = {
  in_progress: 0,
  completed: 1,
  planned: 2,
  dropped: 3,
  missing: 4,
};

function compareYearDesc(a: CompanyWork, b: CompanyWork): number {
  // Undated works (usually announced, not out) go last.
  if (a.year === b.year) return 0;
  if (a.year == null) return 1;
  if (b.year == null) return -1;
  return b.year - a.year;
}

function compareTitle(a: CompanyWork, b: CompanyWork): number {
  return a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
}

export function filterAndSortWorks(
  works: readonly CompanyWork[],
  filters: CompanyWorkFilters,
  stateOf: (externalId: string) => WorkLibraryState,
): CompanyWork[] {
  const filtered = works.filter(work =>
    (filters.includeExtras || !work.is_extra)
    && (filters.type === 'all' || work.media_type === filters.type)
    && matchesRole(work, filters.role)
    && (!filters.onlyMissing || (stateOf(work.external_id) === 'missing' && !work.unreleased))
    && (!filters.masterpiecesOnly || isMasterpiece(work.score)));

  const byYear = (a: CompanyWork, b: CompanyWork) => compareYearDesc(a, b) || compareTitle(a, b);
  switch (filters.sort) {
    case 'title':
      return filtered.sort((a, b) => compareTitle(a, b) || compareYearDesc(a, b));
    case 'status':
      return filtered.sort((a, b) =>
        STATE_ORDER[stateOf(a.external_id)] - STATE_ORDER[stateOf(b.external_id)] || byYear(a, b));
    case 'year':
    default:
      return filtered.sort(byYear);
  }
}

/** Up to two initials for the logo fallback tile ("FromSoftware" → "F",
 *  "Kyoto Animation" → "KA"). */
export function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
  const initials = words.slice(0, 2).map(w => (w.match(/[\p{L}\p{N}]/u)?.[0] ?? '').toUpperCase());
  return initials.join('') || '?';
}
