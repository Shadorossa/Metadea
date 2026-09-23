import { describe, it, expect } from 'vitest';
import {
  consumedUnits,
  episodeOffsets,
  episodePositionInWork,
  isIssueAhead,
  isRangeAhead,
  isUnitAhead,
} from './spoiler-progress';

describe('progress comparison', () => {
  it('compares episodes against the watched count', () => {
    const row = { status: 'watching', progress: 15 };
    expect(isUnitAhead(15, row, 'anime', 'episodes')).toBe(false);
    expect(isUnitAhead(16, row, 'anime', 'episodes')).toBe(true);
    expect(isUnitAhead(1, undefined, 'series', 'episodes')).toBe(true);
  });

  it('compares manga chapters with progress and volumes with progress_2', () => {
    const row = { status: 'reading', progress: 120, progress_2: 13 };
    expect(consumedUnits(row, 'manga', 'chapters')).toBe(120);
    expect(consumedUnits(row, 'manga', 'volumes')).toBe(13);
    expect(isUnitAhead(121, row, 'manga', 'chapters')).toBe(true);
    expect(isUnitAhead(13, row, 'manga', 'volumes')).toBe(false);
    expect(isUnitAhead(14, row, 'manga', 'volumes')).toBe(true);
  });

  it('counts light-novel volumes in progress', () => {
    const row = { status: 'reading', progress: 4 };
    expect(isUnitAhead(5, row, 'lnovel', 'volumes')).toBe(true);
    expect(isUnitAhead(4, row, 'lnovel', 'volumes')).toBe(false);
  });

  it('never hides anything from a completed row or an unknown position', () => {
    expect(isUnitAhead(999, { status: 'completed', progress: 0 }, 'anime', 'episodes')).toBe(false);
    expect(isUnitAhead(null, { status: 'watching', progress: 0 }, 'anime', 'episodes')).toBe(false);
  });

  it('keeps the current range visible and hides the ones that start later', () => {
    const row = { status: 'watching', progress: 12 };
    expect(isRangeAhead(1, row, 'anime', 'episodes')).toBe(false);
    expect(isRangeAhead(13, row, 'anime', 'episodes')).toBe(false);
    expect(isRangeAhead(14, row, 'anime', 'episodes')).toBe(true);
    expect(isRangeAhead(null, row, 'anime', 'episodes')).toBe(false);
  });

  it('turns absolute episode numbers into positions inside each work', () => {
    const episodes = [
      { external_id: 'anime:2', episode_number: 25 },
      { external_id: 'anime:2', episode_number: 26 },
      { external_id: 'anime:1', episode_number: 1 },
      { external_id: '', episode_number: 3 },
      { external_id: 'anime:1', episode_number: -1 },
    ];
    const totals: Record<string, number> = { 'anime:1': 24, 'anime:2': 23 };
    const offsets = episodeOffsets(episodes, 'anime:1', id => totals[id]);
    expect(offsets.get('anime:2')).toBe(24);
    expect(offsets.get('anime:1')).toBe(0);
    expect(episodePositionInWork(episodes[1], offsets, 'anime:1')).toBe(2);
    expect(episodePositionInWork(episodes[3], offsets, 'anime:1')).toBe(3);
    expect(episodePositionInWork(episodes[4], offsets, 'anime:1')).toBeNull();
  });

  it('keeps the numbers of a list that only misses its first episodes, or of an unknown total', () => {
    const partial = [{ external_id: 'anime:1', episode_number: 15 }, { external_id: 'anime:1', episode_number: 16 }];
    expect(episodeOffsets(partial, 'anime:1', () => 24).get('anime:1')).toBe(0);
    expect(episodeOffsets(partial, 'anime:1', () => null).get('anime:1')).toBe(0);
  });

  it('compares a ComicVine first-appearance issue with volume progress', () => {
    const row = { status: 'reading', progress: 90, progress_2: 10 };
    expect(isIssueAhead('11', row, 'manga')).toBe(true);
    expect(isIssueAhead('10', row, 'manga')).toBe(false);
    expect(isIssueAhead('#?', row, 'manga')).toBe(false);
    expect(isIssueAhead('91', { status: 'reading', progress: 90 }, 'comic')).toBe(true);
  });
});
