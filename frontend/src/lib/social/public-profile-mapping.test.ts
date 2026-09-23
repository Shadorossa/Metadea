import { describe, it, expect } from 'vitest';
import type { CatalogSummary, SocialActivityItem, SocialLibraryItem } from '../tauri';
import type { PublicProfile } from './users';
import {
  toSocialLibraryInputs, toSocialActivityInputs, toDayJourney, applyOwnerCovers,
  toSocialCharacterReactionsInput, toPublicBingoBoards,
} from './public-profile-mapping';
import { toLibraryEntry } from './social-library-mapping';

const completion = { externalId: 'game:1', type: 'complete', mediaType: 'game', date: '2026-09-01', timestamp: '2026-09-01T10:00:00Z' };

describe('toSocialLibraryInputs', () => {
  it('attaches the owner cover choice and passes the parity fields through', () => {
    const inputs = toSocialLibraryInputs({
      library: [
        { external_id: 'game:1', progress: 12, minutes_spent: 750, rating_2: 7, reconsumption_count: 1 },
        { external_id: 'anime:5', progress: 3 },
      ],
      coverPreferences: { 'game:1': 'https://x.example/cover.jpg' },
    });
    expect(inputs[0]).toMatchObject({ minutes_spent: 750, rating_2: 7, reconsumption_count: 1, preferred_cover: 'https://x.example/cover.jpg' });
    expect(inputs[1]).toMatchObject({ minutes_spent: null, rating_2: null, preferred_cover: null });
  });
});

describe('toSocialActivityInputs', () => {
  it('prefers the full journey and falls back to the 30 completions', () => {
    const journey = [{ externalId: 'anime:5', type: 'start', timestamp: '2026-09-02T10:00:00Z', date: '2026-09-02' }, { ...completion, occurrence: 2 }];
    const withJourney: Pick<PublicProfile, 'activity' | 'journey'> = { activity: [completion], journey };
    expect(toSocialActivityInputs(withJourney).map(e => [e.type, e.occurrence])).toEqual([['start', null], ['complete', 2]]);
    expect(toSocialActivityInputs({ activity: [completion], journey: [] }).map(e => e.type)).toEqual(['complete']);
    expect(toSocialActivityInputs({ activity: [completion] }).map(e => e.type)).toEqual(['complete']);
  });
});

describe('toDayJourney', () => {
  const row = (overrides: Partial<SocialActivityItem>): SocialActivityItem => ({
    external_id: 'game:1', event_type: 'complete', media_type: 'game', date: '2026-09-01', timestamp: '2026-09-01T10:00:00Z',
    progress_start: null, progress_end: null, occurrence: null, title_main: null, cover_url: null, ...overrides,
  });

  it('keeps every journey kind, grouped by day, newest day first', () => {
    const days = toDayJourney([
      row({ event_type: 'start', timestamp: '2026-09-01T09:00:00Z' }),
      row({ occurrence: 2 }),
      row({ external_id: 'anime:5', event_type: 'progress', date: '2026-09-03', timestamp: '2026-09-03T20:00:00Z', progress_start: 1, progress_end: 3 }),
      row({ event_type: 'rated' }),
    ]);
    expect(days.map(d => d.date)).toEqual(['2026-09-03', '2026-09-01']);
    expect(days[1].events.map(e => [e.type, e.occurrence])).toEqual([['start', undefined], ['complete', 2]]);
    expect(days[0].events[0]).toMatchObject({ type: 'progress', progressStart: 1, progressEnd: 3 });
  });
});

describe('applyOwnerCovers', () => {
  it("paints the owner's cover and skips the disk cache for it", () => {
    const catalogMap = new Map<string, CatalogSummary>([
      ['game:1', { external_id: 'game:1', cover_url: 'https://catalog/1.jpg' } as CatalogSummary],
      ['game:2', { external_id: 'game:2', cover_url: 'https://catalog/2.jpg' } as CatalogSummary],
    ]);
    const cachePaths = new Map([['game:1', 'C:/cache/1.webp'], ['game:2', 'C:/cache/2.webp']]);
    const overridden = applyOwnerCovers(catalogMap, cachePaths, [
      { external_id: 'game:1', preferred_cover: 'https://owner/1.jpg' },
      { external_id: 'game:2', preferred_cover: null },
    ]);
    expect(catalogMap.get('game:1')?.cover_url).toBe('https://owner/1.jpg');
    expect(catalogMap.get('game:2')?.cover_url).toBe('https://catalog/2.jpg');
    expect([...cachePaths.keys()]).toEqual(['game:2']);
    expect([...overridden]).toEqual(['game:1']);
  });
});

describe('toLibraryEntry', () => {
  const synced = (overrides: Partial<SocialLibraryItem>): SocialLibraryItem => ({
    external_id: 'game:1', rating: 8, started_at: null, finished_at: null, notes: null, tags: null,
    status: 'completed', progress: 40, title_main: null, cover_url: null, media_type: null, ...overrides,
  });

  it("uses the owner's real time spent and falls back to the editor estimate only without it", () => {
    expect(toLibraryEntry(synced({ minutes_spent: 2735, rating_2: 6, reconsumption_count: 2 }))).toMatchObject({
      minutes_spent: 2735, rating_2: 6, reconsumption_count: 2,
    });
    expect(toLibraryEntry(synced({}))).toMatchObject({ minutes_spent: 2400, rating_2: null, reconsumption_count: 0 });
  });
});

describe('toSocialCharacterReactionsInput', () => {
  it('is null when the profile shares none, and fills missing lists/fields otherwise', () => {
    expect(toSocialCharacterReactionsInput({})).toBeNull();
    expect(toSocialCharacterReactionsInput({ characterReactions: null })).toBeNull();
    expect(toSocialCharacterReactionsInput({
      characterReactions: { like: [{ external_id: 'character:a:1', name: 'Luffy' }, { external_id: '' }], dislike: [{ external_id: 'character:a:2', image_url: 'https://img/k.jpg' }] },
    })).toEqual({
      like: [{ external_id: 'character:a:1', name: 'Luffy', image_url: null }],
      interest: [],
      dislike: [{ external_id: 'character:a:2', name: null, image_url: 'https://img/k.jpg' }],
    });
  });
});

describe('toPublicBingoBoards', () => {
  const cell = (id: string) => ({ external_id: id, title: id, cover_url: null, media_type: id.split(':')[0] });
  const cells = (n: number, filled: number[]) => Array.from({ length: n }, (_, i) => (filled.includes(i) ? cell(`game:${i + 1}`) : null));

  it('returns nothing when the profile never synced a bingo', () => {
    expect(toPublicBingoBoards({})).toEqual([]);
    expect(toPublicBingoBoards({ bingo: null })).toEqual([]);
    expect(toPublicBingoBoards({ bingo: [] })).toEqual([]);
  });

  it('keeps the synced size, the owner result and lines only on square boards', () => {
    const boards = toPublicBingoBoards({
      bingo: [
        { year: 2025, size: 4, cells: cells(4, [0, 1, 2]), result: { completed: [true, true, true, false], scores: [9, null, 7, null] } },
        { year: 2026, size: 10, cells: cells(10, [0, 1, 2, 3]), result: { completed: [true, true, true, true, false, false, false, false, false, false], scores: Array(10).fill(null) } },
      ],
    });
    expect(boards.map(b => [b.year, b.cells.length])).toEqual([[2026, 10], [2025, 4]]);
    expect(boards[0].result).toMatchObject({ size: 10, done: 4, percent: 40, hasLines: false, lines: [] });
    // Cell 3 is empty: never completed even if the flag says so.
    expect(boards[1].result).toMatchObject({ size: 4, done: 3, filled: 3, percent: 75, hasLines: true, lines: [[0, 1], [0, 2], [1, 2]] });
    expect(boards[1].result?.cells[0]).toEqual({ done: true, rating: 9 });
  });

  it('shows picks only before the result phase and skips malformed boards', () => {
    const boards = toPublicBingoBoards({
      bingo: [
        { year: 2026, size: 16, cells: cells(16, [5]) },
        { year: 2024, size: 9, cells: cells(8, [0]) },
        { year: 2023, size: 4, cells: cells(4, []) },
        { year: 2022, size: 60, cells: cells(60, [0]) },
      ],
    });
    expect(boards).toHaveLength(1);
    expect(boards[0].result).toBeNull();
    expect(boards[0].cells[5]).toEqual(cell('game:6'));
  });
});
