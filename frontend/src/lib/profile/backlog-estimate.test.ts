import { describe, expect, it } from 'vitest';
import type { CatalogSummary, DayJourney, LibraryEntry } from '../tauri';
import { es } from '../../i18n/es';
import type { Translations } from '../../i18n';
import {
  BACKLOG_TYPE_RULES,
  DEFAULT_PACE_MINUTES_PER_WEEK,
  estimateBacklog,
  estimateFinishDate,
  estimateItemRemaining,
  estimatePace,
  formatDuration,
} from './backlog-estimate';

const t = es as unknown as Translations;

function entry(overrides: Partial<LibraryEntry> & { external_id: string; type: string }): LibraryEntry {
  return {
    id: overrides.external_id, user_id: 'u', status: 'planning', rating: null, rating_2: null,
    progress: 0, progress_2: 0, minutes_spent: 0, is_favorite: 0, is_platinum: 0, tags: null, notes: null,
    added_at: null, updated_at: null, selected_platform: null, selected_version: null, started_at: null, finished_at: null,
    ...overrides,
  };
}

function catalog(entries: Array<Partial<CatalogSummary> & { external_id: string }>): Map<string, CatalogSummary> {
  return new Map(entries.map(e => [e.external_id, { id: e.external_id, type: 'anime', format: null, ...e } as CatalogSummary]));
}

const NOW = new Date('2026-09-23T12:00:00Z');

describe('estimateItemRemaining', () => {
  it('anime: remaining episodes × catalog episode length', () => {
    const r = estimateItemRemaining(entry({ external_id: 'a', type: 'anime', progress: 4 }), { external_id: 'a', type: 'anime', total_count: 12, time_length: 25 } as CatalogSummary);
    expect(r).toEqual({ minutes: 8 * 25, usedFallback: false });
  });

  it('anime without episode length falls back to 24 min and flags it', () => {
    const r = estimateItemRemaining(entry({ external_id: 'a', type: 'anime' }), { external_id: 'a', type: 'anime', total_count: 12, time_length: null } as CatalogSummary);
    expect(r).toEqual({ minutes: 12 * 24, usedFallback: true });
  });

  it('series with unknown total assumes the fallback episode count at 45 min', () => {
    const r = estimateItemRemaining(entry({ external_id: 's', type: 'series', progress: 2 }), undefined);
    expect(r).toEqual({ minutes: (10 - 2) * 45, usedFallback: true });
  });

  it('movie: whole runtime, 0 once any progress is logged', () => {
    const row = { external_id: 'm', type: 'anime', format: 'MOVIE', time_length: 95 } as CatalogSummary;
    expect(estimateItemRemaining(entry({ external_id: 'm', type: 'anime' }), row)).toEqual({ minutes: 95, usedFallback: false });
    expect(estimateItemRemaining(entry({ external_id: 'm', type: 'anime', progress: 1 }), row)?.minutes).toBe(0);
    expect(estimateItemRemaining(entry({ external_id: 'm', type: 'movie' }), undefined)).toEqual({ minutes: 110, usedFallback: true });
  });

  it('manga: remaining chapters × 8 min', () => {
    const r = estimateItemRemaining(entry({ external_id: 'mg', type: 'manga', progress: 30 }), { external_id: 'mg', type: 'manga', total_count: 100 } as CatalogSummary);
    expect(r).toEqual({ minutes: 70 * 8, usedFallback: false });
  });

  it('lnovel: remaining volumes × 6 h, read from progress_2/total_count_2', () => {
    const r = estimateItemRemaining(entry({ external_id: 'ln', type: 'lnovel', progress: 200, progress_2: 3 }), { external_id: 'ln', type: 'lnovel', total_count: 500, total_count_2: 10 } as CatalogSummary);
    expect(r).toEqual({ minutes: 7 * 360, usedFallback: false });
  });

  it('book: pages × 1.5 min when known, 8 h flat otherwise', () => {
    expect(estimateItemRemaining(entry({ external_id: 'b', type: 'book', progress: 100 }), { external_id: 'b', type: 'book', total_count: 300 } as CatalogSummary)).toEqual({ minutes: 300, usedFallback: false });
    expect(estimateItemRemaining(entry({ external_id: 'b', type: 'book' }), undefined)).toEqual({ minutes: 480, usedFallback: true });
  });

  it('comic: remaining issues × 20 min', () => {
    expect(estimateItemRemaining(entry({ external_id: 'c', type: 'comic', progress: 1 }), { external_id: 'c', type: 'comic', total_count: 4 } as CatalogSummary)).toEqual({ minutes: 60, usedFallback: false });
  });

  it('game: 20 h minus hours played, always low confidence (time_length is not hours-to-beat)', () => {
    expect(estimateItemRemaining(entry({ external_id: 'g', type: 'game', progress: 5 }), { external_id: 'g', type: 'game', time_length: 90 } as CatalogSummary)).toEqual({ minutes: 15 * 60, usedFallback: true });
    expect(estimateItemRemaining(entry({ external_id: 'g', type: 'game', progress: 40 }), undefined)?.minutes).toBe(0);
  });

  it('vnovel: time_length hours or 30 h, minus hours played', () => {
    expect(estimateItemRemaining(entry({ external_id: 'v', type: 'vnovel', progress: 10 }), { external_id: 'v', type: 'vnovel', time_length: 50 } as CatalogSummary)).toEqual({ minutes: 40 * 60, usedFallback: false });
    expect(estimateItemRemaining(entry({ external_id: 'v', type: 'vnovel' }), undefined)).toEqual({ minutes: 30 * 60, usedFallback: true });
  });

  it('returns null for types without a duration model', () => {
    expect(estimateItemRemaining(entry({ external_id: 'x', type: 'character' }), undefined)).toBeNull();
    expect(BACKLOG_TYPE_RULES.character).toBeUndefined();
  });
});

describe('estimateBacklog', () => {
  const rows = catalog([
    { external_id: 'a1', type: 'anime', total_count: 12, time_length: 24 },
    { external_id: 'a2', type: 'anime', total_count: 24, time_length: 24 },
    { external_id: 'g1', type: 'game' },
    { external_id: 'm1', type: 'manga', total_count: 10 },
  ]);
  const items = [
    entry({ external_id: 'a1', type: 'anime', status: 'planning' }),
    entry({ external_id: 'a2', type: 'anime', status: 'watching', progress: 20 }),
    entry({ external_id: 'g1', type: 'game', status: 'paused', progress: 2 }),
    entry({ external_id: 'm1', type: 'manga', status: 'completed', progress: 10 }),
    entry({ external_id: 'd1', type: 'anime', status: 'dropped' }),
  ];

  it('default scope counts planning + in-progress remaining, not paused/completed/dropped', () => {
    const { byType, total } = estimateBacklog(items, rows);
    expect(byType).toHaveLength(1);
    expect(byType[0]).toMatchObject({ type: 'anime', pendingCount: 2, remainingMinutes: 12 * 24 + 4 * 24, missingDataCount: 0, lowConfidence: false });
    expect(total).toMatchObject({ pendingCount: 2, remainingMinutes: 16 * 24, lowConfidence: false });
  });

  it('planning-only scope drops in-progress works', () => {
    const { total } = estimateBacklog(items, rows, { scope: ['planning'] });
    expect(total).toMatchObject({ pendingCount: 1, remainingMinutes: 12 * 24 });
  });

  it('paused scope adds the game, whose guessed duration flags its type as low confidence', () => {
    const { byType, total } = estimateBacklog(items, rows, { scope: ['planning', 'in_progress', 'paused'] });
    const game = byType.find(b => b.type === 'game');
    expect(game).toMatchObject({ pendingCount: 1, remainingMinutes: 18 * 60, missingDataCount: 1, lowConfidence: true });
    // 1 of 3 works guessed → total is still trustworthy
    expect(total).toMatchObject({ pendingCount: 3, missingDataCount: 1, lowConfidence: false });
    // sorted by remaining minutes, biggest first
    expect(byType[0].type).toBe('game');
  });

  it('total goes low confidence once more than half the works are guessed', () => {
    const { total } = estimateBacklog([
      entry({ external_id: 'g1', type: 'game', status: 'planning' }),
      entry({ external_id: 'g2', type: 'game', status: 'planning' }),
      entry({ external_id: 'a1', type: 'anime', status: 'planning' }),
    ], rows);
    expect(total).toMatchObject({ pendingCount: 3, missingDataCount: 2, lowConfidence: true });
  });

  it('skips edition children so a version log is not counted twice', () => {
    const { total } = estimateBacklog([
      entry({ external_id: 'g1', type: 'game', status: 'planning', selected_version: 'g1-se' }),
      entry({ external_id: 'g1-se', type: 'game', status: 'planning' }),
    ], rows);
    expect(total.pendingCount).toBe(1);
  });

  it('empty library → empty estimate', () => {
    expect(estimateBacklog([], rows)).toEqual({ byType: [], total: { type: 'all', pendingCount: 0, remainingMinutes: 0, missingDataCount: 0, lowConfidence: false } });
  });
});

describe('estimatePace', () => {
  const rows = catalog([{ external_id: 'a1', type: 'anime', time_length: 20 }]);
  const day = (daysAgo: number, events: DayJourney['events']): DayJourney => {
    const d = new Date(NOW.getTime() - daysAgo * 86_400_000);
    return { date: d.toISOString().slice(0, 10), events: events.map(e => ({ ...e, timestamp: d.toISOString() })) };
  };

  it('averages the last 4 weeks, per type and overall', () => {
    const journey = [
      day(3, [{ externalId: 'a1', type: 'progress', mediaType: 'anime', progressStart: 0, progressEnd: 6, timestamp: '' }]), // 120 min
      day(10, [{ externalId: 'g1', type: 'progress', mediaType: 'game', progressStart: 1, progressEnd: 3, timestamp: '' }]), // 120 min
      day(40, [{ externalId: 'a1', type: 'progress', mediaType: 'anime', progressStart: 6, progressEnd: 12, timestamp: '' }]), // outside the window
    ];
    const pace = estimatePace(journey, rows, NOW);
    expect(pace).toEqual({ minutesPerWeek: 240 / 4, weeks: 4, lowConfidence: false, byType: { anime: 30, game: 30 } });
  });

  it('falls back to a 12-week window when the last 4 are empty', () => {
    const journey = [day(40, [{ externalId: 'a1', type: 'complete', mediaType: 'anime', progressStart: 0, progressEnd: 12, timestamp: '' }])];
    const pace = estimatePace(journey, rows, NOW);
    expect(pace).toMatchObject({ minutesPerWeek: 240 / 12, weeks: 12, lowConfidence: true });
  });

  it('ignores events with no measurable delta and future timestamps', () => {
    const journey = [
      day(1, [{ externalId: 'a1', type: 'start', mediaType: 'anime', timestamp: '' }]),
      day(-1, [{ externalId: 'a1', type: 'progress', mediaType: 'anime', progressStart: 0, progressEnd: 3, timestamp: '' }]),
    ];
    expect(estimatePace(journey, rows, NOW)).toEqual({ minutesPerWeek: DEFAULT_PACE_MINUTES_PER_WEEK, weeks: 0, lowConfidence: true, byType: {} });
  });

  it('empty history → global 10 h/week default, low confidence', () => {
    expect(estimatePace([], rows, NOW)).toEqual({ minutesPerWeek: 600, weeks: 0, lowConfidence: true, byType: {} });
  });
});

describe('formatDuration', () => {
  const H = 60, D = 24 * H;
  it.each([
    [0, 'nada'],
    [59, '59 min'],
    [60, '1 hora'],
    [23 * H + 59, '23 horas 59 min'],
    [D, '1 día'],
    [2 * D, '2 días'],
    [7 * D, '1 semana'],
    [3 * 7 * D, '3 semanas'],
    [30 * D, '1 mes'],
    [365 * D + 4 * 30 * D, '1 año 4 meses'],
    [365 * D + 3 * D, '1 año'], // the unit right below (months) is empty → no trailing "3 días"
  ])('%i min → %s', (minutes, expected) => {
    expect(formatDuration(minutes, t)).toBe(expected);
  });
});

describe('estimateFinishDate', () => {
  it('adds remaining / pace weeks to now', () => {
    const finish = estimateFinishDate(NOW, 2 * 600, 600);
    expect(finish?.toISOString()).toBe(new Date(NOW.getTime() + 14 * 86_400_000).toISOString());
  });

  it('returns null with no pace', () => {
    expect(estimateFinishDate(NOW, 100, 0)).toBeNull();
  });
});
