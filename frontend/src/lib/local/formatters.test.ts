import { describe, it, expect } from 'vitest';
import { formatDateTimeShort, formatUnixTimestampShort } from '../shared/text/format-date';
import { formatPlaytime, formatLastPlayed, formatWatchedAt, formatPlaybackTime } from './formatters';

describe('formatPlaytime', () => {
  it('renders hours and zero-padded minutes', () => {
    expect(formatPlaytime(0)).toBe('0h 00m');
    expect(formatPlaytime(5)).toBe('0h 05m');
    expect(formatPlaytime(90)).toBe('1h 30m');
    expect(formatPlaytime(1500)).toBe('25h 00m');
  });

  it('floors fractional minutes', () => {
    expect(formatPlaytime(59.9)).toBe('0h 59m');
  });

  it('shows a dash for missing, negative or NaN input', () => {
    expect(formatPlaytime()).toBe('—');
    expect(formatPlaytime(-1)).toBe('—');
    expect(formatPlaytime(NaN)).toBe('—');
  });
});

describe('formatLastPlayed', () => {
  it('shows a dash for a missing or zero timestamp', () => {
    expect(formatLastPlayed()).toBe('—');
    expect(formatLastPlayed(0)).toBe('—');
  });

  it('delegates to the short unix-timestamp formatter', () => {
    expect(formatLastPlayed(1_700_000_000)).toBe(formatUnixTimestampShort(1_700_000_000));
    expect(formatLastPlayed(1_700_000_000)).toContain('2023');
  });
});

describe('formatWatchedAt', () => {
  it('parses a SQLite timestamp as UTC before formatting', () => {
    expect(formatWatchedAt('2024-03-09 15:30:00')).toBe(formatDateTimeShort(new Date('2024-03-09T15:30:00Z')));
  });

  it('returns the raw input when it cannot be parsed', () => {
    expect(formatWatchedAt('not a date')).toBe('not a date');
    expect(formatWatchedAt('')).toBe('');
  });
});

describe('formatPlaybackTime', () => {
  it('renders minutes and seconds under an hour', () => {
    expect(formatPlaybackTime(0)).toBe('0:00');
    expect(formatPlaybackTime(65)).toBe('1:05');
    expect(formatPlaybackTime(599)).toBe('9:59');
  });

  it('adds an hours field past the first hour', () => {
    expect(formatPlaybackTime(3600)).toBe('1:00:00');
    expect(formatPlaybackTime(3661.9)).toBe('1:01:01');
    expect(formatPlaybackTime(36_000)).toBe('10:00:00');
  });

  it('clamps invalid input to zero', () => {
    expect(formatPlaybackTime(-5)).toBe('0:00');
    expect(formatPlaybackTime(NaN)).toBe('0:00');
    expect(formatPlaybackTime(Infinity)).toBe('0:00');
  });
});
