import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import {
  buildLocalResumeUrl,
  episodeLine,
  parseDbTimestamp,
  pickLastWatched,
  remainingLabel,
  watchedFraction,
  type ContinueWatchingSources,
} from './continue-watching';

const empty: ContinueWatchingSources = { resume: [], history: [], frames: [], episodes: [] };

describe('pickLastWatched', () => {
  it('is null when nothing was watched', () => {
    expect(pickLastWatched(empty)).toBeNull();
  });

  it('resumes the most recent stop, merging its frame and episode meta', () => {
    const item = pickLastWatched({
      resume: [
        { external_id: 'anime:1', episode_number: 13, position_seconds: 700, updated_at: '2026-09-22 20:00:00' },
        { external_id: 'anime:2', episode_number: 4, position_seconds: 50, updated_at: '2026-09-20 20:00:00' },
      ],
      history: [{ external_id: 'anime:3', episode_number: 9, watched_at: '2026-09-21 10:00:00' }],
      frames: [{ external_id: 'anime:1', episode_number: 13, frame_path: 'C:/f/anime_1_13.jpg', position_seconds: 690, duration_seconds: 1420, updated_at: '2026-09-22 19:59:59' }],
      episodes: [{ external_id: 'anime:1', episode_number: 13, season_number: 1, name: 'Truth', cover_url: 'https://still/13.jpg' }],
    });
    expect(item).toMatchObject({
      externalId: 'anime:1',
      episodeNumber: 13,
      seasonNumber: 1,
      episodeTitle: 'Truth',
      framePath: 'C:/f/anime_1_13.jpg',
      stillUrl: 'https://still/13.jpg',
      positionSeconds: 700,
      durationSeconds: 1420,
    });
  });

  it('points a finished episode at the next one, from the start', () => {
    const item = pickLastWatched({
      ...empty,
      resume: [{ external_id: 'anime:1', episode_number: 2, position_seconds: 100, updated_at: '2026-09-20 10:00:00' }],
      history: [{ external_id: 'anime:3', episode_number: 9, watched_at: '2026-09-23 08:00:00' }],
      episodes: [{ external_id: 'anime:3', episode_number: 10, season_number: 0, name: null, cover_url: null }],
    });
    expect(item).toMatchObject({ externalId: 'anime:3', episodeNumber: 10, seasonNumber: null, positionSeconds: 0, durationSeconds: null, framePath: null });
  });

  it('lets the caller skip filler after a finished episode', () => {
    const item = pickLastWatched(
      { ...empty, history: [{ external_id: 'anime:20', episode_number: 135, watched_at: '2026-09-23 08:00:00' }] },
      (id, finished) => (id === 'anime:20' && finished === 135 ? 142 : finished + 1),
    );
    expect(item).toMatchObject({ externalId: 'anime:20', episodeNumber: 142, positionSeconds: 0 });
  });

  it('reads SQLite UTC timestamps and ISO strings alike', () => {
    expect(parseDbTimestamp('2026-09-23 08:00:00')).toBe(Date.UTC(2026, 8, 23, 8));
    expect(parseDbTimestamp('2026-09-23T08:00:00.000Z')).toBe(Date.UTC(2026, 8, 23, 8));
  });
});

describe('labels', () => {
  const strings = en.home;

  it('builds the episode line with and without a season and title', () => {
    expect(episodeLine({ episodeNumber: 13, seasonNumber: 1, episodeTitle: 'Truth' }, strings)).toBe('S1 · E13 — Truth');
    expect(episodeLine({ episodeNumber: 12.5, seasonNumber: null, episodeTitle: null }, strings)).toBe('E12,5');
  });

  it('formats the remaining time and the watched fraction', () => {
    expect(remainingLabel(700, 1420, strings)).toBe('12 min left');
    expect(remainingLabel(0, 5400, strings)).toBe('1 h 30 min left');
    expect(remainingLabel(1419, 1420, strings)).toBe('1 min left');
    expect(remainingLabel(100, null, strings)).toBeNull();
    expect(watchedFraction(355, 1420)).toBe(0.25);
    expect(watchedFraction(10, null)).toBeNull();
  });
});

describe('buildLocalResumeUrl', () => {
  it("uses Local's own resume entry point", () => {
    expect(buildLocalResumeUrl('anime:21', 'anime')).toBe('/local?type=anime&resume=anime%3A21');
    expect(buildLocalResumeUrl('series:1399', 'series')).toBe('/local?type=series&resume=series%3A1399');
    expect(buildLocalResumeUrl('x:1', 'podcast')).toBeNull();
  });
});
