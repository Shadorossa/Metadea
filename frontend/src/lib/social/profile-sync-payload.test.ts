import { describe, it, expect } from 'vitest';
import type { DayJourney, LibraryEntry } from '../tauri';
import {
  buildLibraryPayload, buildJourneyPayload, buildCoverPreferencesPayload, buildDualRatingPayload, normalizeNameFont,
  MAX_SYNCED_JOURNEY_EVENTS,
  buildCharacterReactionsPayload, MAX_SYNCED_CHARACTER_REACTIONS,
  buildBingoPayload,
} from './profile-sync-payload';
import type { BingoCell, YearlyBingoData } from '../tauri/yearly-bingo';

const entry = (overrides: Partial<LibraryEntry>): LibraryEntry => ({
  id: 'x', user_id: 'me', external_id: 'game:1', type: 'game', status: 'completed', rating: 8, rating_2: 6,
  progress: 12, progress_2: 0, minutes_spent: 750, is_favorite: 1, is_platinum: 1, tags: ['rpg'], notes: 'great',
  added_at: '2026-08-01', updated_at: '2026-09-02', selected_platform: 'pc', selected_version: null,
  started_at: '2026-08-01', finished_at: '2026-09-01', reconsumption_count: 1, reconsuming: 0,
  ...overrides,
});

describe('buildLibraryPayload', () => {
  it('carries real time spent, re-runs and dates, not per-machine bookkeeping', () => {
    const [item] = buildLibraryPayload([entry({})], true);
    expect(item).toMatchObject({
      external_id: 'game:1', minutes_spent: 750, rating_2: 6, reconsumption_count: 1, reconsuming: 0,
      updated_at: '2026-09-02', added_at: '2026-08-01', tags: ['rpg'],
    });
    expect(item).not.toHaveProperty('selected_platform');
    expect(item).not.toHaveProperty('is_platinum');
  });

  it('keeps rating_2 home when the owner does not show a second rating', () => {
    expect(buildLibraryPayload([entry({})], false)[0].rating_2).toBeNull();
  });
});

describe('buildJourneyPayload', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const journey: DayJourney[] = [
    { date: '2026-09-20', events: [
      { externalId: 'anime:5', type: 'progress', mediaType: 'anime', timestamp: '2026-09-20T20:00:00Z', progressStart: 1, progressEnd: 3 },
      { externalId: 'game:1', type: 'complete', mediaType: 'game', timestamp: '2026-09-20T21:00:00Z', occurrence: 2 },
    ] },
    { date: '2026-01-02', events: [{ externalId: 'movie:9', type: 'start', mediaType: 'movie', timestamp: '2026-01-02T10:00:00Z' }] },
    { date: '2025-09-01', events: [{ externalId: 'movie:8', type: 'complete', mediaType: 'movie', timestamp: '2025-09-01T10:00:00Z' }] },
  ];

  it('keeps every kind from the last year, newest first', () => {
    expect(buildJourneyPayload(journey, now)).toEqual([
      { externalId: 'game:1', type: 'complete', mediaType: 'game', date: '2026-09-20', timestamp: '2026-09-20T21:00:00Z', occurrence: 2 },
      { externalId: 'anime:5', type: 'progress', mediaType: 'anime', date: '2026-09-20', timestamp: '2026-09-20T20:00:00Z', progressStart: 1, progressEnd: 3 },
      { externalId: 'movie:9', type: 'start', mediaType: 'movie', date: '2026-01-02', timestamp: '2026-01-02T10:00:00Z' },
    ]);
  });

  it('caps the number of events', () => {
    const busy: DayJourney[] = [{
      date: '2026-09-22',
      events: Array.from({ length: MAX_SYNCED_JOURNEY_EVENTS + 50 }, (_, i) => ({
        externalId: `game:${i + 1}`, type: 'progress' as const, mediaType: 'game',
        timestamp: `2026-09-22T10:00:00.${String(i).padStart(4, '0')}Z`,
      })),
    }];
    expect(buildJourneyPayload(busy, now)).toHaveLength(MAX_SYNCED_JOURNEY_EVENTS);
  });
});

describe('buildCoverPreferencesPayload', () => {
  it('sends only public URLs for works in the synced library', () => {
    const out = buildCoverPreferencesPayload({
      'game:1': 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg',
      'game:2': 'https://not-in-library.example/x.jpg',
      'game:3': 'asset://localhost/C:/covers/3.webp',
      'game:4': 'data:image/png;base64,AAAA',
      'game:5': `https://x.example/${'a'.repeat(1100)}`,
    }, new Set(['game:1', 'game:3', 'game:4', 'game:5']));
    expect(out).toEqual({ 'game:1': 'https://images.igdb.com/igdb/image/upload/t_cover_big/abc.jpg' });
  });
});

describe('buildDualRatingPayload / normalizeNameFont', () => {
  it('publishes the second rating setup only when it is on', () => {
    const settings = { enabled: true, name1: ' Story ', name2: '', system2: '10-dec' as const, min2: 1, max2: 5 };
    expect(buildDualRatingPayload(settings)).toEqual({ name_1: 'Story', name_2: null, system_2: '10-dec', min_2: 1, max_2: 5 });
    expect(buildDualRatingPayload({ ...settings, enabled: false })).toBeNull();
    expect(buildDualRatingPayload({ ...settings, min2: 5, max2: 5 })).toBeNull();
  });

  it('only sends plain font ids', () => {
    expect(normalizeNameFont('fraunces')).toBe('fraunces');
    expect(normalizeNameFont('Comic Sans; }')).toBeNull();
    expect(normalizeNameFont(undefined)).toBeNull();
  });
});

describe('buildCharacterReactionsPayload', () => {
  it('keeps order, names and public portraits only', () => {
    const payload = buildCharacterReactionsPayload({
      like: [
        { external_id: 'character:a:1', name: '  Luffy ', image_url: 'https://img/luffy.jpg' },
        { external_id: 'character:a:2', name: '', image_url: 'C:/Users/me/AppData/characters/x.png' },
      ],
      interest: [{ external_id: 'character:a:3', name: 'Nami', image_url: 'data:image/png;base64,AAAA' }],
      dislike: [],
    });
    expect(payload.like).toEqual([
      { external_id: 'character:a:1', name: 'Luffy', image_url: 'https://img/luffy.jpg' },
      { external_id: 'character:a:2', name: null, image_url: null },
    ]);
    expect(payload.interest).toEqual([{ external_id: 'character:a:3', name: 'Nami', image_url: null }]);
    expect(payload.dislike).toEqual([]);
  });

  it('caps each list and keeps a character in one list only', () => {
    const many = Array.from({ length: MAX_SYNCED_CHARACTER_REACTIONS + 20 }, (_, i) => ({ external_id: `character:a:${i}`, name: null, image_url: null }));
    const payload = buildCharacterReactionsPayload({ like: many, interest: [many[0]], dislike: [] });
    expect(payload.like).toHaveLength(MAX_SYNCED_CHARACTER_REACTIONS);
    expect(payload.interest).toEqual([]);
  });
});

describe('buildBingoPayload', () => {
  const cell = (id: string, cover: string | null = null): BingoCell => ({ external_id: id, title: ` Title ${id} `, cover_url: cover, media_type: id.split(':')[0] });
  const bingo = (year: number, items: BingoCell[]): YearlyBingoData => ({ year, size: items.length, items, created_at: 0, updated_at: 0 });
  const nine = (year: number) => bingo(year, [
    cell('game:1', 'https://images.igdb.com/c.jpg'), cell('anime:2', 'asset://localhost/C:/c.webp'), cell('movie:3', 'http://x/c.jpg'),
    null, cell('book:4'), null, null, null, cell('manga:5'),
  ]);
  const library = [
    { external_id: 'game:1', status: 'completed', finished_at: '2026-05-01', rating: 8 },
    { external_id: 'book:4', status: 'completed', finished_at: null, rating: null },
    { external_id: 'manga:5', status: 'completed', finished_at: '2026-02-01', rating: 7 },
    { external_id: 'anime:2', status: 'watching', finished_at: null, rating: 6 },
  ];

  it('sends the boards newest first with their size, https covers only and no result before Dec 19', () => {
    const payload = buildBingoPayload([nine(2025), nine(2026)], library, new Date(2026, 8, 23));
    expect(payload.map(b => [b.year, b.size, b.cells.length])).toEqual([[2026, 9, 9], [2025, 9, 9]]);
    const [current, previous] = payload;
    expect(current.cells[0]).toEqual({ external_id: 'game:1', title: 'Title game:1', cover_url: 'https://images.igdb.com/c.jpg', media_type: 'game' });
    expect(current.cells.slice(1, 4).map(c => c?.cover_url ?? null)).toEqual([null, null, null]);
    expect(current.cells[3]).toBeNull();
    expect(current.result).toBeUndefined();
    // Last year's board is past its results day: the owner's result, 2026
    // completions don't count for 2025.
    expect(previous.result?.completed).toEqual([false, false, false, false, true, false, false, false, false]);
    expect(previous.result?.scores).toEqual([8, 6, null, null, null, null, null, null, 7]);
  });

  it("includes the current year's result from Dec 19", () => {
    const [board] = buildBingoPayload([nine(2026)], library, new Date(2026, 11, 19));
    expect(board.result?.completed).toEqual([true, false, false, false, true, false, false, false, true]);
    expect(board.result?.completed).toHaveLength(board.size);
  });

  it('empties cells the Worker would reject and skips off-range sizes', () => {
    const [board] = buildBingoPayload([bingo(2026, [
      { external_id: 'no-colon', title: 'x', cover_url: null, media_type: 'game' },
      { external_id: 'game:1', title: '   ', cover_url: null, media_type: 'game' },
      { external_id: 'game:2', title: 't'.repeat(400), cover_url: null, media_type: 'not a type' },
      { external_id: 'game:3', title: 't'.repeat(400), cover_url: null, media_type: 'game' },
    ])], [], new Date(2026, 8, 23));
    expect(board.cells.slice(0, 3)).toEqual([null, { external_id: 'game:1', title: 'game:1', cover_url: null, media_type: 'game' }, null]);
    expect(board.cells[3]?.title).toHaveLength(300);
    expect(buildBingoPayload([bingo(2026, Array.from({ length: 50 }, () => null))], [], new Date(2026, 8, 23))).toEqual([]);
  });
});
