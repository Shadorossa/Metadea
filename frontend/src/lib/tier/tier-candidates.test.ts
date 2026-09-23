import { describe, expect, it } from 'vitest';
import {
  collectCandidateFacets, filterLibraryCandidates, templateFilters, DEFAULT_CANDIDATE_FILTERS, TIER_TEMPLATE_IDS,
  type CandidateCatalogRow, type CandidateLibraryRow,
} from './tier-candidates';

function row(external_id: string, status: string | null, rating: number | null, extra: Partial<CandidateLibraryRow> = {}): CandidateLibraryRow {
  return { external_id, type: external_id.split(':')[0], status, rating, is_favorite: 0, finished_at: null, ...extra };
}

const entries: CandidateLibraryRow[] = [
  row('anime:1', 'completed', 9, { finished_at: '2024-03-01T00:00:00Z' }),
  row('anime:2', 'completed', 6, { finished_at: '2025-01-02' }),
  row('anime:3', 'watching', null),
  row('game:1', 'completed', 8, { is_favorite: 1 }),
  row('manga:1', 'dropped', 3),
  row('anime:1', 'completed', 9), // duplicate row must not duplicate the candidate
];

const catalog = new Map<string, CandidateCatalogRow>([
  ['anime:1', { title_main: 'Frieren', cover_url: 'f.jpg', release_year: 2024, genres_csv: 'Adventure, Drama' }],
  ['anime:2', { title_main: 'Dandadan', cover_url: null, release_year: 2024, genres_csv: 'Action' }],
  ['anime:3', { title_main: 'Apothecary', cover_url: null, release_year: 2023, genres_csv: 'Drama' }],
  ['game:1', { title_main: 'Elden Ring', cover_url: null, release_year: 2022, genres_csv: null }],
]);

const ids = (list: { id: string }[]) => list.map(c => c.id);

describe('filterLibraryCandidates', () => {
  it('returns everything, deduped, best-rated first', () => {
    expect(ids(filterLibraryCandidates(entries, catalog, DEFAULT_CANDIDATE_FILTERS)))
      .toEqual(['anime:1', 'game:1', 'anime:2', 'manga:1', 'anime:3']);
  });

  it('filters by type, status, year, genre and rating', () => {
    const f = DEFAULT_CANDIDATE_FILTERS;
    expect(ids(filterLibraryCandidates(entries, catalog, { ...f, type: 'anime', status: 'completed', year: 2024 }))).toEqual(['anime:1', 'anime:2']);
    expect(ids(filterLibraryCandidates(entries, catalog, { ...f, status: 'in_progress' }))).toEqual(['anime:3']);
    expect(ids(filterLibraryCandidates(entries, catalog, { ...f, genre: 'Drama' }))).toEqual(['anime:1', 'anime:3']);
    expect(ids(filterLibraryCandidates(entries, catalog, { ...f, minRating: 8 }))).toEqual(['anime:1', 'game:1']);
    expect(ids(filterLibraryCandidates(entries, catalog, { ...f, finishedYear: 2025 }))).toEqual(['anime:2']);
  });

  it('honours favourites from the row or the favourites map, and exclusions', () => {
    const favs = filterLibraryCandidates(entries, catalog, { ...DEFAULT_CANDIDATE_FILTERS, favoritesOnly: true }, new Set(), new Set(['manga:1']));
    expect(ids(favs)).toEqual(['game:1', 'manga:1']);
    const excluded = filterLibraryCandidates(entries, catalog, DEFAULT_CANDIDATE_FILTERS, new Set(['anime:1', 'game:1']));
    expect(ids(excluded)).toEqual(['anime:2', 'manga:1', 'anime:3']);
  });

  it('carries title, cover and rating for the pool', () => {
    const [first] = filterLibraryCandidates(entries, catalog, DEFAULT_CANDIDATE_FILTERS);
    expect(first).toEqual({ id: 'anime:1', title: 'Frieren', cover: 'f.jpg', type: 'anime', rating: 9 });
  });
});

describe('templates', () => {
  it('"all completed anime of 2024"', () => {
    const filters = templateFilters('completed_of_year', { type: 'anime', year: 2024 });
    expect(ids(filterLibraryCandidates(entries, catalog, filters))).toEqual(['anime:1', 'anime:2']);
  });

  it('builds a filter for every template', () => {
    for (const id of TIER_TEMPLATE_IDS) {
      expect(templateFilters(id, { type: 'all', year: 2024 }).type).toBe('all');
    }
    expect(ids(filterLibraryCandidates(entries, catalog, templateFilters('finished_in_year', { type: 'all', year: 2024 })))).toEqual(['anime:1']);
    expect(ids(filterLibraryCandidates(entries, catalog, templateFilters('top_rated', { type: 'all', year: 0 })))).toEqual(['anime:1', 'game:1']);
    expect(ids(filterLibraryCandidates(entries, catalog, templateFilters('favorites', { type: 'game', year: 0 })))).toEqual(['game:1']);
  });
});

describe('collectCandidateFacets', () => {
  it('lists the types, years and genres present', () => {
    expect(collectCandidateFacets(entries, catalog)).toEqual({
      types: ['anime', 'game', 'manga'],
      years: [2024, 2023, 2022],
      genres: ['Action', 'Adventure', 'Drama'],
    });
  });
});
