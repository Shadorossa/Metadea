import { describe, it, expect } from 'vitest';
import type { SagaEntry } from '../../anilist/saga';
import {
  computeSagaCompletion,
  isSagaCompletionVisible,
  pickHeadline,
  describeTypeBreakdown,
  type SagaCompletionLibraryRow,
  type SagaCompletionCatalogRow,
} from './saga-completion';

const CURRENT_YEAR = 2026;

function entry(externalId: string, year: number | null = 2010): SagaEntry {
  return { externalId, title: externalId, cover: null, format: null, mediaType: externalId.split(':')[0], year, month: null, day: null };
}

function library(rows: Record<string, Partial<SagaCompletionLibraryRow>>): Map<string, SagaCompletionLibraryRow> {
  return new Map(Object.entries(rows).map(([id, row]) => [id, { status: null, progress: 0, ...row }]));
}

function catalog(rows: Record<string, Partial<SagaCompletionCatalogRow>>): Map<string, SagaCompletionCatalogRow> {
  return new Map(Object.entries(rows).map(([id, row]) => [id, { type: id.split(':')[0], total_count: null, ...row }]));
}

const strings = {
  label: 'Saga progress',
  count: 'You have completed {completed} of {total} {type}',
  percent: 'You have completed {percent} % of the whole universe ({types})',
  breakdown: '{type}: {completed}/{total} · {percent} %',
  upcoming_not_counted: '{count} upcoming not counted',
  types: { anime: 'anime', manga: 'manga', lnovel: 'light novels', game: 'games', vnovel: 'visual novels', movie: 'movies', series: 'series', book: 'books', comic: 'comics', event: 'events' },
};

const singles = (...ids: string[]) => ids.map(id => [entry(id)]);

describe('computeSagaCompletion', () => {
  it('counts same-type members as plain works and picks the count headline', () => {
    const result = computeSagaCompletion(
      singles('game:1', 'game:2', 'game:3', 'game:4', 'game:5', 'game:6', 'game:7'),
      library({ 'game:1': { status: 'completed' }, 'game:2': { status: 'completed' }, 'game:3': { status: 'completed' }, 'game:4': { status: 'completed' }, 'game:5': { status: 'playing' } }),
      catalog({}),
      { currentYear: CURRENT_YEAR },
    );
    expect(result.completedCount).toBe(4);
    expect(result.totalCount).toBe(7);
    expect(result.weightedPercent).toBe(57);
    expect(result.unitLabel).toBe('works');
    expect(pickHeadline(result, strings)).toBe('You have completed 4 of 7 games');
  });

  it('uses the percent headline listing every type when the saga mixes types', () => {
    const result = computeSagaCompletion(
      singles('anime:1', 'movie:2', 'anime:3'),
      library({ 'anime:1': { status: 'completed', progress: 12 }, 'movie:2': { status: 'completed' }, 'anime:3': { status: 'watching', progress: 6 } }),
      catalog({ 'anime:1': { total_count: 12 }, 'anime:3': { total_count: 24 } }),
      { currentYear: CURRENT_YEAR },
    );
    // 12 + 1 + 6 consumed of 12 + 1 + 24 units.
    expect(result.weightedPercent).toBe(51);
    expect(result.unitLabel).toBe('works');
    expect(pickHeadline(result, strings)).toBe('You have completed 51 % of the whole universe (anime, movies)');
    expect(describeTypeBreakdown(result, strings)).toEqual(['anime: 1/2 · 50 %', 'movies: 1/1 · 100 %']);
  });

  it('weights episodic members by progress over total episodes', () => {
    const result = computeSagaCompletion(
      singles('anime:1', 'anime:2'),
      library({ 'anime:1': { status: 'completed', progress: 26 }, 'anime:2': { status: 'watching', progress: 25 } }),
      catalog({ 'anime:1': { total_count: 26 }, 'anime:2': { total_count: 74 } }),
      { currentYear: CURRENT_YEAR },
    );
    expect(result.weightedPercent).toBe(51);
    expect(result.completedCount).toBe(1);
    expect(result.unitLabel).toBe('episodes');
    expect(result.byType.anime.percentUnits).toBe(51);
  });

  it('clamps progress to the known total and a completed entry counts as fully consumed', () => {
    const result = computeSagaCompletion(
      singles('manga:1', 'manga:2'),
      library({ 'manga:1': { status: 'completed', progress: 3 }, 'manga:2': { status: 'reading', progress: 500 } }),
      catalog({ 'manga:1': { total_count: 100 }, 'manga:2': { total_count: 100 } }),
      { currentYear: CURRENT_YEAR },
    );
    expect(result.weightedPercent).toBe(100);
  });

  it('treats an unknown total as a single all-or-nothing unit', () => {
    const result = computeSagaCompletion(
      singles('anime:1', 'anime:2'),
      library({ 'anime:1': { status: 'watching', progress: 40 }, 'anime:2': { status: 'completed', progress: 40 } }),
      catalog({}),
      { currentYear: CURRENT_YEAR },
    );
    expect(result.weightedPercent).toBe(50);
    expect(result.completedCount).toBe(1);
  });

  it('excludes upcoming members from the denominator but reports them', () => {
    const result = computeSagaCompletion(
      [[entry('game:1')], [entry('game:2')], [entry('game:3', 2027)], [entry('game:4')]],
      library({ 'game:1': { status: 'completed' }, 'game:2': { status: 'completed' } }),
      catalog({ 'game:4': { status: 'NOT_YET_RELEASED' } }),
      { currentYear: CURRENT_YEAR },
    );
    expect(result.totalCount).toBe(2);
    expect(result.upcomingCount).toBe(2);
    expect(result.weightedPercent).toBe(100);
  });

  it('counts an alternative-editions panel once, through its furthest edition', () => {
    const result = computeSagaCompletion(
      [[entry('anime:1'), entry('anime:1b')], [entry('anime:2')]],
      library({ 'anime:1': { status: 'watching', progress: 2 }, 'anime:1b': { status: 'completed', progress: 10 } }),
      catalog({ 'anime:1': { total_count: 12 }, 'anime:1b': { total_count: 10 }, 'anime:2': { total_count: 10 } }),
      { currentYear: CURRENT_YEAR },
    );
    expect(result.totalCount).toBe(2);
    expect(result.completedCount).toBe(1);
    expect(result.weightedPercent).toBe(50);
  });
});

describe('isSagaCompletionVisible', () => {
  it('hides the bar at or under one percent', () => {
    const result = computeSagaCompletion(
      singles('anime:1', 'anime:2'),
      library({ 'anime:1': { status: 'watching', progress: 1 } }),
      catalog({ 'anime:1': { total_count: 100 }, 'anime:2': { total_count: 100 } }),
      { currentYear: CURRENT_YEAR },
    );
    expect(result.weightedPercent).toBe(1);
    expect(isSagaCompletionVisible(result)).toBe(false);
  });

  it('shows the bar above one percent', () => {
    const result = computeSagaCompletion(
      singles('anime:1', 'anime:2'),
      library({ 'anime:1': { status: 'watching', progress: 4 } }),
      catalog({ 'anime:1': { total_count: 100 }, 'anime:2': { total_count: 100 } }),
      { currentYear: CURRENT_YEAR },
    );
    expect(isSagaCompletionVisible(result)).toBe(true);
  });

  it('hides the bar when the user has no library rows in the saga', () => {
    const result = computeSagaCompletion(singles('game:1'), library({}), catalog({}), { currentYear: CURRENT_YEAR });
    expect(result.weightedPercent).toBe(0);
    expect(isSagaCompletionVisible(result)).toBe(false);
  });
});
