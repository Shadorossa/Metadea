import { describe, expect, it } from 'vitest';
import type { TimeToBeat } from '../tauri/time-to-beat';
import {
  beatProgress, formatBeatHours, hasTimeToBeatData, roundBeatHours, shortestBeatSeconds, timeToBeatPills, vndbLengthKey,
} from './time-to-beat';

function ttb(overrides: Partial<TimeToBeat>): TimeToBeat {
  return {
    externalId: 'game:1', mainSeconds: null, extraSeconds: null, completionistSeconds: null,
    votes: null, lengthBucket: null, source: 'igdb', fetchedAt: 0, ...overrides,
  };
}

describe('timeToBeatPills', () => {
  it('lists only the lengths the source has, main first', () => {
    const pills = timeToBeatPills(ttb({ mainSeconds: 36000, completionistSeconds: 90000 }));
    expect(pills).toEqual([{ kind: 'main', seconds: 36000 }, { kind: 'completionist', seconds: 90000 }]);
  });

  it('treats zero as unknown', () => {
    expect(timeToBeatPills(ttb({ mainSeconds: 0 }))).toEqual([]);
  });
});

describe('vndbLengthKey', () => {
  it('maps VNDB buckets 1–5 to labels', () => {
    expect([1, 2, 3, 4, 5].map(vndbLengthKey)).toEqual([
      'length_very_short', 'length_short', 'length_medium', 'length_long', 'length_very_long',
    ]);
  });

  it('rejects anything outside 1–5', () => {
    expect(vndbLengthKey(0)).toBeNull();
    expect(vndbLengthKey(6)).toBeNull();
    expect(vndbLengthKey(2.5)).toBeNull();
    expect(vndbLengthKey(null)).toBeNull();
  });
});

describe('hasTimeToBeatData', () => {
  it('is true for durations or a bucket alone, false otherwise', () => {
    expect(hasTimeToBeatData(ttb({ extraSeconds: 3600 }))).toBe(true);
    expect(hasTimeToBeatData(ttb({ source: 'vndb', lengthBucket: 3 }))).toBe(true);
    expect(hasTimeToBeatData(ttb({}))).toBe(false);
    expect(hasTimeToBeatData(null)).toBe(false);
  });
});

describe('formatBeatHours', () => {
  it('rounds to halves under 10 h and whole hours above', () => {
    expect(roundBeatHours(7 * 60 + 20)).toBe(7.5);
    expect(roundBeatHours(7 * 60 + 10)).toBe(7);
    expect(roundBeatHours(31 * 60 + 40)).toBe(32);
    expect(roundBeatHours(5)).toBe(0.5);
  });

  it('fills the template with a locale-formatted number', () => {
    expect(formatBeatHours(450, '{hours} h', 'en')).toBe('7.5 h');
    expect(formatBeatHours(450, '{hours} h', 'es')).toBe('7,5 h');
    expect(formatBeatHours(1800, '{hours}時間', 'ja')).toBe('30時間');
  });
});

describe('beatProgress', () => {
  it('measures playtime against the main story', () => {
    const progress = beatProgress(12 * 60, 30 * 3600)!;
    expect(progress.ratio).toBeCloseTo(0.4);
    expect(progress.done).toBe(false);
    expect(progress.remainingMinutes).toBe(18 * 60);
  });

  it('caps the bar at 100% and marks it done past the target', () => {
    const progress = beatProgress(45 * 60, 30 * 3600)!;
    expect(progress.ratio).toBe(1);
    expect(progress.done).toBe(true);
    expect(progress.remainingMinutes).toBe(0);
  });

  it('is null without playtime or a main-story length', () => {
    expect(beatProgress(0, 3600)).toBeNull();
    expect(beatProgress(undefined, 3600)).toBeNull();
    expect(beatProgress(60, null)).toBeNull();
    expect(beatProgress(-5, 3600)).toBeNull();
  });
});

describe('shortestBeatSeconds', () => {
  it('prefers the main story and falls back to longer runs', () => {
    expect(shortestBeatSeconds(ttb({ mainSeconds: 100, extraSeconds: 200 }))).toBe(100);
    expect(shortestBeatSeconds(ttb({ completionistSeconds: 300 }))).toBe(300);
    expect(shortestBeatSeconds(ttb({ lengthBucket: 2 }))).toBeUndefined();
    expect(shortestBeatSeconds(undefined)).toBeUndefined();
  });
});
