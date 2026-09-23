import { describe, it, expect } from 'vitest';
import type { CatalogSummary, LibraryEntry } from '../tauri';
import {
  buildWebProfileSummary, webProfileSyncFields, webProfileUrl, webProfileWorkIds,
  type WebProfileSources, type WebProfileSummaryPayload,
} from './web-profile-payload';

const entry = (overrides: Partial<LibraryEntry>): LibraryEntry => ({
  id: 'x', user_id: 'me', external_id: 'game:1', type: 'game', status: 'completed', rating: 8, rating_2: null,
  progress: 1, progress_2: 0, minutes_spent: 600, is_favorite: 0, is_platinum: 0, tags: null, notes: 'private note',
  added_at: '2026-01-01', updated_at: '2026-01-01', selected_platform: null, selected_version: null,
  started_at: null, finished_at: '2026-03-01', reconsumption_count: 0, reconsuming: 0,
  ...overrides,
});

const catalogRow = (external_id: string, overrides: Partial<CatalogSummary> = {}): CatalogSummary => ({
  id: external_id, external_id, type: external_id.split(':')[0], format: null, status: null,
  title_main: `Title ${external_id}`, title_english: null, title_romaji: null, title_native: null,
  cover_url: `https://images.igdb.com/igdb/image/upload/t_cover_big/${external_id.replace(':', '')}.jpg`,
  release_day: null, release_month: null, release_year: null, total_count: null, total_count_2: null,
  time_length: null, genres_csv: 'Action, Drama', parent_id: null, updated_at: '2026-01-01',
  ...overrides,
});

const sources = (overrides: Partial<WebProfileSources> = {}): WebProfileSources => ({
  items: [
    entry({ external_id: 'game:1', rating: 9, updated_at: '2026-03-01' }),
    entry({ external_id: 'anime:5', type: 'anime', status: 'watching', rating: 7, progress: 3, minutes_spent: 0, updated_at: '2026-09-01', finished_at: null }),
    entry({ external_id: 'movie:3', type: 'movie', status: 'planning', rating: null, minutes_spent: 0, finished_at: null }),
  ],
  catalog: [
    catalogRow('game:1'),
    catalogRow('anime:5', { cover_url: 'asset://localhost/C:/covers/5.jpg', genres_csv: 'Drama' }),
    catalogRow('movie:3', { title_main: null, title_english: 'English Title' }),
  ],
  relations: [],
  favorites: { multimedia: ['movie:3', 'game:1'], game: ['game:1'] },
  journey: [
    { externalId: 'anime:5', type: 'progress', mediaType: 'anime', date: '2026-09-01', timestamp: '2026-09-01T10:00:00Z' },
    { externalId: 'book:unknown', type: 'start', mediaType: 'book', date: '2026-08-01', timestamp: '2026-08-01T10:00:00Z' },
  ],
  ...overrides,
});

describe('webProfileSyncFields', () => {
  const summary = { stats: {}, top_genres: [], time_by_type: [], works: [] } as unknown as WebProfileSummaryPayload;

  it('sends nothing until this device has chosen, so it never overrides another device', () => {
    expect(webProfileSyncFields(null, summary)).toEqual({});
  });

  it('turning it off sends false and clears the summary', () => {
    expect(webProfileSyncFields(false, summary)).toEqual({ web_profile_public: false, web_profile: null });
  });

  it('turning it on sends true with the summary, or keeps the server copy when there is none', () => {
    expect(webProfileSyncFields(true, summary)).toEqual({ web_profile_public: true, web_profile: summary });
    expect(webProfileSyncFields(true, null)).toEqual({ web_profile_public: true });
  });
});

describe('buildWebProfileSummary', () => {
  it('lists the works the page shows once each, Hall of Fame first', () => {
    expect(webProfileWorkIds(sources())).toEqual(['movie:3', 'game:1', 'anime:5', 'book:unknown']);
  });

  it('carries titles and public covers only, never notes', () => {
    const summary = buildWebProfileSummary(sources());
    expect(summary.works).toEqual([
      { external_id: 'movie:3', title: 'English Title', cover_url: 'https://images.igdb.com/igdb/image/upload/t_cover_big/movie3.jpg' },
      { external_id: 'game:1', title: 'Title game:1', cover_url: 'https://images.igdb.com/igdb/image/upload/t_cover_big/game1.jpg' },
      // A local asset:// cover means nothing on the web.
      { external_id: 'anime:5', title: 'Title anime:5', cover_url: null },
    ]);
    expect(JSON.stringify(summary)).not.toContain('private note');
  });

  it("uses the profile's own calculators for stats, genres and time", () => {
    const summary = buildWebProfileSummary(sources());
    expect(summary.stats).toEqual({ total_works: 3, completed: 1, in_progress: 1, average_rating: 8, hours: 10 + 3 * 24 / 60 });
    expect(summary.top_genres).toEqual([{ name: 'Drama', count: 3 }, { name: 'Action', count: 2 }]);
    expect(summary.time_by_type.find(t => t.type === 'game')).toEqual({ type: 'game', hours: 10, count: 1 });
  });

  it('reports no average when nothing is rated', () => {
    const summary = buildWebProfileSummary(sources({ items: [entry({ rating: null })] }));
    expect(summary.stats.average_rating).toBeNull();
  });
});

describe('webProfileUrl', () => {
  it('points at the pages.dev host by account id', () => {
    expect(webProfileUrl('3f2a-9c')).toBe('https://metadea.pages.dev/u/3f2a-9c');
  });
});
