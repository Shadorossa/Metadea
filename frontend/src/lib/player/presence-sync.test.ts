import { describe, it, expect } from 'vitest';
import {
  buildPresenceSnapshot, computePresenceTimestamps, formatPresenceLines, formatThemePresenceLines, shouldResendPresence,
} from './presence-sync';

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
    expect(computePresenceTimestamps(NOW, 60, 1500, 0.5)).toEqual({ startTime: NOW - 120, endTime: NOW + 2880 });
    // Never faster than 1×: a stray higher value keeps real-time maths.
    expect(computePresenceTimestamps(NOW, 60, 1500, 2)).toEqual({ startTime: NOW - 60, endTime: NOW + 1440 });
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

describe('formatPresenceLines', () => {
  it('shows the series in details and the episode label + title in state', () => {
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 2, episodeLabel: 'S01E02', episodeTitle: 'The School of the Grassland', status: 'playing' }))
      .toEqual({ details: 'Watching Show', state: 'S01E02 - The School of the Grassland' });
  });

  it('falls back to a zero-padded E<NN> when no label is known', () => {
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 2, status: 'playing' }).state).toBe('E02');
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 12, episodeTitle: 'Finale', status: 'playing' }).state).toBe('E12 - Finale');
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 3, episodeLabel: '  ', status: 'playing' }).state).toBe('E03');
  });

  it('keeps movies to their M label', () => {
    expect(formatPresenceLines({ title: 'Film', episodeNumber: 1, episodeLabel: 'M01', episodeTitle: 'Film', status: 'playing' }).state).toBe('M01');
  });

  it('appends Paused while paused', () => {
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 2, episodeLabel: 'S01E02', episodeTitle: 'Pilot', status: 'paused' }).state)
      .toBe('S01E02 - Pilot · Paused');
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 2, status: 'paused' }).state).toBe('E02 · Paused');
  });
});

describe('formatThemePresenceLines', () => {
  it('uses the song title with artists and media title', () => {
    expect(formatThemePresenceLines({
      themeLabel: 'OP1', songTitle: 'Colors', artists: 'FLOW', mediaTitle: 'Code Geass', status: 'playing',
    })).toEqual({ details: 'Listening Colors', state: 'FLOW · Code Geass' });
  });

  it('falls back to the OP/ED label and omits missing artists', () => {
    expect(formatThemePresenceLines({
      themeLabel: 'ED2', songTitle: null, artists: null, mediaTitle: 'Code Geass', status: 'playing',
    })).toEqual({ details: 'Listening ED2', state: 'Code Geass' });
  });

  it('appends Paused while paused', () => {
    expect(formatThemePresenceLines({
      themeLabel: 'OP1', songTitle: ' Colors ', artists: 'FLOW', mediaTitle: 'Code Geass', status: 'paused',
    }).state).toBe('FLOW · Code Geass · Paused');
  });
});
