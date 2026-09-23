import { describe, it, expect } from 'vitest';
import {
  malKindForType, appRatingToMalScore, toMalDate, buildMalAnimeUpdate, buildMalMangaUpdate,
  malDateToFuzzy, malListItemToImportItem, importMediaStubForKnownRow, type MalSyncInput,
} from './mapping';
import type { MalListItem } from '../tauri/mal';

const base: MalSyncInput = {
  externalId: 'anime:21', type: 'anime', status: 'watching', rating: 7.5, progress: 12, progressVolumes: 0,
  startedAt: '2026-01-05', finishedAt: '',
};

describe('malKindForType', () => {
  it('routes anime, manga and light novels and skips everything else', () => {
    expect(malKindForType('anime')).toBe('anime');
    expect(malKindForType('anime_tv')).toBe('anime');
    expect(malKindForType('manga')).toBe('manga');
    expect(malKindForType('lnovel')).toBe('manga');
    for (const type of ['game', 'vnovel', 'movie', 'series', 'book', 'comic', 'event', 'character', '', null, undefined]) {
      expect(malKindForType(type)).toBeNull();
    }
  });
});

describe('appRatingToMalScore', () => {
  it('rounds the 0-10 rating to MAL integers, 0 meaning unset', () => {
    expect(appRatingToMalScore(0)).toBe(0);
    expect(appRatingToMalScore(null)).toBe(0);
    expect(appRatingToMalScore(7.5)).toBe(8);
    expect(appRatingToMalScore(7.4)).toBe(7);
    expect(appRatingToMalScore(10)).toBe(10);
    expect(appRatingToMalScore(12)).toBe(10);
    // A rating that exists is never flattened into "no score".
    expect(appRatingToMalScore(0.3)).toBe(1);
  });
});

describe('toMalDate', () => {
  it('only passes full ISO dates through', () => {
    expect(toMalDate('2026-01-05')).toBe('2026-01-05');
    expect(toMalDate(' 2026-01-05 ')).toBe('2026-01-05');
    expect(toMalDate('2026-01')).toBeUndefined();
    expect(toMalDate('')).toBeUndefined();
    expect(toMalDate(null)).toBeUndefined();
    expect(toMalDate('05/01/2026')).toBeUndefined();
  });
});

describe('buildMalAnimeUpdate', () => {
  it('maps status, score, episodes and dates into MAL vocabulary', () => {
    expect(buildMalAnimeUpdate(base)).toEqual({
      status: 'watching', score: 8, num_watched_episodes: 12, start_date: '2026-01-05',
    });
  });

  it('maps every app status and omits an empty one', () => {
    expect(buildMalAnimeUpdate({ ...base, status: 'planning' }).status).toBe('plan_to_watch');
    expect(buildMalAnimeUpdate({ ...base, status: 'paused' }).status).toBe('on_hold');
    expect(buildMalAnimeUpdate({ ...base, status: 'dropped' }).status).toBe('dropped');
    expect(buildMalAnimeUpdate({ ...base, status: 'completed', finishedAt: '2026-02-01' })).toMatchObject({
      status: 'completed', finish_date: '2026-02-01',
    });
    expect(buildMalAnimeUpdate({ ...base, status: '' })).not.toHaveProperty('status');
    expect(buildMalAnimeUpdate({ ...base, status: 'playing' })).not.toHaveProperty('status');
  });

  it('never sends negative or fractional counters', () => {
    expect(buildMalAnimeUpdate({ ...base, progress: -2 }).num_watched_episodes).toBe(0);
    expect(buildMalAnimeUpdate({ ...base, progress: 3.9 }).num_watched_episodes).toBe(3);
    expect(buildMalAnimeUpdate({ ...base, rating: 0 }).score).toBe(0);
  });
});

describe('buildMalMangaUpdate', () => {
  it('uses the reading statuses and both counters', () => {
    expect(buildMalMangaUpdate({ ...base, type: 'manga', status: 'reading', progress: 120, progressVolumes: 14 })).toEqual({
      status: 'reading', score: 8, num_chapters_read: 120, num_volumes_read: 14, start_date: '2026-01-05',
    });
    expect(buildMalMangaUpdate({ ...base, status: 'planning' }).status).toBe('plan_to_read');
    expect(buildMalMangaUpdate({ ...base, status: 'watching' }).status).toBe('reading');
  });
});

describe('malDateToFuzzy', () => {
  it('accepts full and partial MAL dates', () => {
    expect(malDateToFuzzy('2019-04-07')).toEqual({ year: 2019, month: 4, day: 7 });
    expect(malDateToFuzzy('2019-04')).toEqual({ year: 2019, month: 4, day: undefined });
    expect(malDateToFuzzy('2019')).toEqual({ year: 2019, month: undefined, day: undefined });
    expect(malDateToFuzzy(null)).toBeNull();
    expect(malDateToFuzzy('')).toBeNull();
    expect(malDateToFuzzy('0000-01-01')).toBeNull();
  });
});

const listItem: MalListItem = {
  mal_id: 2, title: 'Berserk', status: 'on_hold', score: 9, progress: 370, progress_volumes: 41,
  is_repeating: false, start_date: '2020-05', finish_date: null, updated_at: null,
};

describe('malListItemToImportItem', () => {
  it('produces the AniList-shaped item the shared importer merges', () => {
    const media = importMediaStubForKnownRow('manga:30002', 'manga')!;
    expect(malListItemToImportItem(listItem, media)).toEqual({
      mediaId: 30002, status: 'PAUSED', score: 9, progress: 370, progressVolumes: 41,
      startedAt: { year: 2020, month: 5, day: undefined }, completedAt: null, media,
    });
  });

  it('treats an unscored MAL row as no rating and an unknown status as planning', () => {
    const media = importMediaStubForKnownRow('anime:1', 'anime')!;
    const item = malListItemToImportItem({ ...listItem, score: 0, status: 'weird' }, media);
    expect(item.score).toBeNull();
    expect(item.status).toBe('PLANNING');
    expect(item).not.toHaveProperty('notes');
  });
});

describe('reconsumption flags', () => {
  it('maps a re-run in progress to is_rewatching / is_rereading and omits it when untracked', () => {
    expect(buildMalAnimeUpdate({ ...base, reconsuming: true })).toMatchObject({ is_rewatching: true });
    expect(buildMalAnimeUpdate({ ...base, reconsuming: false })).toMatchObject({ is_rewatching: false });
    expect(buildMalAnimeUpdate(base)).not.toHaveProperty('is_rewatching');
    const manga = { ...base, type: 'manga', status: 'reading' };
    expect(buildMalMangaUpdate({ ...manga, reconsuming: true })).toMatchObject({ is_rereading: true });
    expect(buildMalMangaUpdate(manga)).not.toHaveProperty('is_rereading');
  });

  it('sends the rewatch/reread counter only when tracked', () => {
    expect(buildMalAnimeUpdate({ ...base, repeat: 2 })).toMatchObject({ num_times_rewatched: 2 });
    expect(buildMalAnimeUpdate({ ...base, repeat: -1 })).toMatchObject({ num_times_rewatched: 0 });
    expect(buildMalAnimeUpdate(base)).not.toHaveProperty('num_times_rewatched');
    expect(buildMalMangaUpdate({ ...base, type: 'manga', repeat: 3 })).toMatchObject({ num_times_reread: 3 });
    expect(buildMalMangaUpdate({ ...base, type: 'manga' })).not.toHaveProperty('num_times_reread');
  });
});

describe('importMediaStubForKnownRow', () => {
  it('derives the AniList type and novel format from the catalog row', () => {
    expect(importMediaStubForKnownRow('anime:21', 'anime')).toMatchObject({ id: 21, type: 'ANIME', format: undefined });
    expect(importMediaStubForKnownRow('lnovel:5', 'lnovel')).toMatchObject({ id: 5, type: 'MANGA', format: 'NOVEL' });
    expect(importMediaStubForKnownRow('manga:x', 'manga')).toBeNull();
    expect(importMediaStubForKnownRow('21', 'anime')).toBeNull();
  });
});
