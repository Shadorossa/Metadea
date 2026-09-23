// "Fill the pool" queries over the user's own library: the filter panel
// and the one-click templates ("all completed anime of 2024", ...) both
// build a LibraryCandidateFilters and run it through
// filterLibraryCandidates. Pure — the component hands in the library rows
// and the catalog summaries it already loaded.
import { isInProgressStatus } from '../media/media-types';

export const STATUS_FILTERS = ['any', 'planning', 'in_progress', 'completed', 'paused', 'dropped'] as const;
export type StatusFilter = typeof STATUS_FILTERS[number];

export interface LibraryCandidateFilters {
  type: string;            // 'all' or a media type
  status: StatusFilter;
  year: number | null;     // release year
  finishedYear: number | null;
  genre: string | null;
  minRating: number | null; // 0-10 internal scale
  favoritesOnly: boolean;
}

export const DEFAULT_CANDIDATE_FILTERS: LibraryCandidateFilters = {
  type: 'all', status: 'any', year: null, finishedYear: null, genre: null, minRating: null, favoritesOnly: false,
};

/** The library columns the filters read (a LibraryEntry satisfies it). */
export interface CandidateLibraryRow {
  external_id: string;
  type: string;
  status: string | null;
  rating: number | null;
  is_favorite: number;
  finished_at: string | null;
}

/** The catalog columns the filters read (a CatalogSummary satisfies it). */
export interface CandidateCatalogRow {
  title_main: string | null;
  cover_url: string | null;
  release_year: number | null;
  genres_csv: string | null;
}

export interface TierCandidate {
  id: string;
  title: string | null;
  cover: string | null;
  type: string;
  rating: number | null;
}

function genresOf(row: CandidateCatalogRow | undefined): string[] {
  return (row?.genres_csv ?? '').split(',').map(g => g.trim()).filter(Boolean);
}

function yearOf(date: string | null): number | null {
  const year = date ? Number.parseInt(date.slice(0, 4), 10) : NaN;
  return Number.isFinite(year) ? year : null;
}

function matchesStatus(status: string | null, filter: StatusFilter): boolean {
  if (filter === 'any') return true;
  if (filter === 'in_progress') return isInProgressStatus(status);
  return status === filter;
}

export function filterLibraryCandidates(
  entries: readonly CandidateLibraryRow[],
  catalog: ReadonlyMap<string, CandidateCatalogRow>,
  filters: LibraryCandidateFilters,
  exclude: ReadonlySet<string> = new Set(),
  favoriteIds: ReadonlySet<string> = new Set(),
): TierCandidate[] {
  const seen = new Set<string>();
  const out: TierCandidate[] = [];
  for (const entry of entries) {
    const id = entry.external_id;
    if (exclude.has(id) || seen.has(id)) continue;
    const meta = catalog.get(id);
    if (filters.type !== 'all' && entry.type !== filters.type) continue;
    if (!matchesStatus(entry.status, filters.status)) continue;
    if (filters.year !== null && meta?.release_year !== filters.year) continue;
    if (filters.finishedYear !== null && yearOf(entry.finished_at) !== filters.finishedYear) continue;
    if (filters.genre && !genresOf(meta).includes(filters.genre)) continue;
    if (filters.minRating !== null && (entry.rating === null || entry.rating < filters.minRating)) continue;
    if (filters.favoritesOnly && !entry.is_favorite && !favoriteIds.has(id)) continue;
    seen.add(id);
    out.push({ id, title: meta?.title_main ?? null, cover: meta?.cover_url ?? null, type: entry.type, rating: entry.rating });
  }
  // Best-rated first, so a "top N" drag from the pool starts with them.
  return out.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || (a.title ?? a.id).localeCompare(b.title ?? b.id));
}

export interface CandidateFacets {
  types: string[];
  years: number[];
  genres: string[];
}

/** The values the filter selects offer: only what the library contains. */
export function collectCandidateFacets(entries: readonly CandidateLibraryRow[], catalog: ReadonlyMap<string, CandidateCatalogRow>): CandidateFacets {
  const types = new Set<string>();
  const years = new Set<number>();
  const genres = new Set<string>();
  for (const entry of entries) {
    types.add(entry.type);
    const meta = catalog.get(entry.external_id);
    if (meta?.release_year) years.add(meta.release_year);
    genresOf(meta).forEach(g => genres.add(g));
  }
  return {
    types: [...types].sort(),
    years: [...years].sort((a, b) => b - a),
    genres: [...genres].sort((a, b) => a.localeCompare(b)),
  };
}

// ── Quick templates ─────────────────────────────────────────────────────

export const TIER_TEMPLATE_IDS = ['completed_of_year', 'finished_in_year', 'top_rated', 'favorites'] as const;
export type TierTemplateId = typeof TIER_TEMPLATE_IDS[number];

export interface TierTemplateParams {
  type: string;
  year: number;
}

/** Which parameters a template's form shows. */
export const TIER_TEMPLATE_PARAMS: Record<TierTemplateId, { type: boolean; year: boolean }> = {
  completed_of_year: { type: true, year: true },
  finished_in_year: { type: true, year: true },
  top_rated: { type: true, year: false },
  favorites: { type: true, year: false },
};

export const TOP_RATED_MIN = 8;

export function templateFilters(id: TierTemplateId, params: TierTemplateParams): LibraryCandidateFilters {
  const base = { ...DEFAULT_CANDIDATE_FILTERS, type: params.type };
  switch (id) {
    case 'completed_of_year': return { ...base, status: 'completed', year: params.year };
    case 'finished_in_year': return { ...base, status: 'completed', finishedYear: params.year };
    case 'top_rated': return { ...base, minRating: TOP_RATED_MIN };
    case 'favorites': return { ...base, favoritesOnly: true };
  }
}
