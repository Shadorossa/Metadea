import { describe, it, expect } from 'vitest';
import { buildPresenceSnapshot, computePresenceTimestamps, shouldResendPresence } from './presence-sync';

const NOW = 1_000_000;

describe('computePresenceTimestamps', () => {
  it('is null until the duration is known', () => {
    expect(computePresenceTimestamps(NOW, 10, 0)).toBeNull();
    expect(computePresenceTimestamps(NOW, 10, Number.NaN)).toBeNull();
  });

  it('projects elapsed and remaining onto the wall clock', () => {
    expect(computePresenceTimestamps(NOW, 60, 1500)).toEqual({ startTime: NOW - 60, endTime: NOW + 1440 });
  });

  it('stretches by playback speed', () => {
    expect(computePresenceTimestamps(NOW, 60, 1500, 2)).toEqual({ startTime: NOW - 30, endTime: NOW + 720 });
    expect(computePresenceTimestamps(NOW, 60, 1500, 0)).toEqual({ startTime: NOW - 60, endTime: NOW + 1440 });
  });

  it('clamps a position past the end', () => {
    expect(computePresenceTimestamps(NOW, 2000, 1500)).toEqual({ startTime: NOW - 1500, endTime: NOW });
  });
});

describe('buildPresenceSnapshot', () => {
  it('drops timestamps when paused or when the duration is unknown', () => {
    expect(buildPresenceSnapshot('paused', NOW, 10, 100)).toEqual({ status: 'paused' });
    expect(buildPresenceSnapshot('playing', NOW, 10, 0)).toEqual({ status: 'playing' });
    expect(buildPresenceSnapshot('playing', NOW, 10, 100)).toEqual({ status: 'playing', startTime: NOW - 10, endTime: NOW + 90 });
  });
});

describe('shouldResendPresence', () => {
  const playing = { status: 'playing' as const, startTime: NOW - 10, endTime: NOW + 90 };

  it('always sends the first presence and every status flip', () => {
    expect(shouldResendPresence(null, playing)).toBe(true);
    expect(shouldResendPresence(playing, { status: 'paused' })).toBe(true);
    expect(shouldResendPresence({ status: 'paused' }, playing)).toBe(true);
  });

  it('re-sends when the duration becomes known even though start did not drift', () => {
    expect(shouldResendPresence({ status: 'playing' }, playing)).toBe(true);
    expect(shouldResendPresence(playing, { status: 'playing' })).toBe(true);
  });

  it('ignores tick jitter but catches a real drift of start or end', () => {
    expect(shouldResendPresence(playing, { ...playing, startTime: playing.startTime + 2, endTime: playing.endTime + 2 })).toBe(false);
    expect(shouldResendPresence(playing, { ...playing, startTime: playing.startTime - 30 })).toBe(true);
    expect(shouldResendPresence(playing, { ...playing, endTime: playing.endTime + 600 })).toBe(true);
    expect(shouldResendPresence({ status: 'paused' }, { status: 'paused' })).toBe(false);
  });
});
