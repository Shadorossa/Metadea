import { describe, expect, it } from 'vitest';
import { backloggdStatus, mergeBackloggdEntry, planBackloggdImport, type BackloggdImportItem } from './import';
import type { BackloggdGame } from './toolkittd-csv';
import type { IgdbSlugMatch } from '../tauri/igdb';
import { libraryEntry } from '../../../tests/support/library-entry';

const game = (overrides: Partial<BackloggdGame> = {}): BackloggdGame => ({
  name: 'Celeste', slug: 'celeste', played: false, playing: false, backlog: false, wishlist: false, liked: false,
  mastered: false, rating: null, startDate: null, finishDate: null, minutes: 0, review: null, ...overrides,
});
const match = (slug: string, id: number, isVn = false): IgdbSlugMatch => ({
  slug, id, name: slug, cover_url: null, release_year: null, is_vn: isVn,
});
const NOW = '2026-10-27T12:00:00.000Z';

describe('backloggdStatus', () => {
  it.each([
    [{ playing: true, played: true }, 'playing'],
    [{ played: true }, 'completed'],
    [{ backlog: true }, 'planning'],
    [{ wishlist: true }, 'planning'],
  ])('%j → %s', (flags, status) => {
    expect(backloggdStatus(game(flags))).toBe(status);
  });
});

describe('planBackloggdImport', () => {
  it('files by IGDB id, keeps a library sibling id, dedupes and lists the unmatched', () => {
    const games = [
      game({ slug: 'celeste' }),
      game({ name: 'Steins;Gate', slug: 'steins-gate' }),
      game({ name: 'Doki', slug: 'doki' }),
      game({ name: 'Celeste again', slug: 'celeste' }),
      game({ name: 'Unknown', slug: 'nope' }),
      game({ name: 'No URL', slug: null }),
    ];
    const plan = planBackloggdImport(
      games,
      [match('celeste', 1), match('steins-gate', 2, true), match('doki', 3, true)],
      new Set(['game:3']),
    );
    expect(plan.items.map(item => item.externalId)).toEqual(['game:1', 'vnovel:2', 'game:3']);
    expect(plan.unmatched.map(g => g.name)).toEqual(['Unknown', 'No URL']);
  });
});

describe('mergeBackloggdEntry', () => {
  const item = (overrides: Partial<BackloggdGame>): BackloggdImportItem => ({
    externalId: 'game:1', type: 'game', game: game(overrides), match: match('celeste', 1),
  });

  it('builds a new entry from the export', () => {
    const merged = mergeBackloggdEntry(undefined, item({
      played: true, rating: 8, startDate: '2024-01-01', finishDate: '2024-02-01', liked: true, mastered: true,
      minutes: 600, review: 'Loved it',
    }), NOW);
    expect(merged).toMatchObject({
      external_id: 'game:1', type: 'game', status: 'completed', rating: 8, started_at: '2024-01-01',
      finished_at: '2024-02-01', is_favorite: 1, is_platinum: 1, minutes_spent: 600, progress: 10, notes: 'Loved it',
      added_at: NOW,
    });
  });

  it('only adds to an existing entry, never clears or downgrades it', () => {
    const existing = libraryEntry({
      external_id: 'game:1', status: 'completed', rating: 9, started_at: '2023-05-05', is_favorite: 1,
      minutes_spent: 900, notes: 'My own notes',
    });
    const merged = mergeBackloggdEntry(existing, item({ backlog: true, minutes: 60, review: 'From Backloggd' }), NOW);
    expect(merged).toMatchObject({
      status: 'completed', rating: 9, started_at: '2023-05-05', is_favorite: 1, minutes_spent: 900, notes: 'My own notes',
      progress: 1,
    });
  });
});
