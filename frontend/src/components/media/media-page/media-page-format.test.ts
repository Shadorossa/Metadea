import { describe, it, expect } from 'vitest';
import { formatEpisodeNumber, formatThemeEpisodes, formatMatchDate } from './media-page-format';

describe('formatEpisodeNumber', () => {
  it('renders a regular episode as a plain number', () => {
    expect(formatEpisodeNumber(1)).toBe('1');
    expect(formatEpisodeNumber(24)).toBe('24');
  });

  // Specials are stored as negative numbers so they sort after the run.
  it('renders a negative number as a special', () => {
    expect(formatEpisodeNumber(-1)).toBe('Sp1');
    expect(formatEpisodeNumber(-12)).toBe('Sp12');
  });

  it('renders zero as a plain number', () => {
    expect(formatEpisodeNumber(0)).toBe('0');
  });
});

describe('formatThemeEpisodes', () => {
  it('returns null for empty input', () => {
    expect(formatThemeEpisodes(null, 0)).toBeNull();
    expect(formatThemeEpisodes(undefined, 0)).toBeNull();
    expect(formatThemeEpisodes('   ', 0)).toBeNull();
  });

  it('trims and passes through when there is no offset', () => {
    expect(formatThemeEpisodes('  1-13  ', 0)).toBe('1-13');
    expect(formatThemeEpisodes('1-13', -5)).toBe('1-13');
  });

  it('shifts every number by the offset', () => {
    expect(formatThemeEpisodes('1-13', 24)).toBe('25-37');
    expect(formatThemeEpisodes('5', 10)).toBe('15');
  });

  it('shifts every number in a comma-separated list', () => {
    expect(formatThemeEpisodes('1, 3, 5', 10)).toBe('11, 13, 15');
  });

  // A range already past the offset is absolute, not season-relative, so
  // shifting it again would double-count.
  it('leaves a range that already starts past the offset alone', () => {
    expect(formatThemeEpisodes('25-37', 24)).toBe('25-37');
  });

  it('shifts when the first number equals the offset', () => {
    expect(formatThemeEpisodes('24-30', 24)).toBe('48-54');
  });

  it('passes through text with no numbers', () => {
    expect(formatThemeEpisodes('ED', 24)).toBe('ED');
  });
});

describe('formatMatchDate', () => {
  it('returns the time alone when there is no date', () => {
    expect(formatMatchDate(null, '20:00:00')).toBe('20:00:00');
    expect(formatMatchDate(undefined, undefined)).toBe('');
  });

  it('appends a trimmed HH:MM to a formatted date', () => {
    const out = formatMatchDate('2026-03-09', '20:45:00');
    expect(out).toContain('·');
    expect(out).toContain('20:45');
    expect(out).not.toContain('20:45:00');
  });

  it('renders the date alone when there is no time', () => {
    const out = formatMatchDate('2026-03-09', null);
    expect(out).not.toContain('·');
    expect(out).toContain('2026');
  });

  it('falls back to joining the raw parts when the date cannot be parsed', () => {
    expect(formatMatchDate('not-a-date', '20:00')).toBe('not-a-date 20:00');
    expect(formatMatchDate('not-a-date', null)).toBe('not-a-date');
  });
});
