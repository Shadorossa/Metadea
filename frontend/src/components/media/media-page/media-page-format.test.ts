import { describe, it, expect } from 'vitest';
import { formatEpisodeNumber, formatThemeEpisodes, formatMatchDate, mergeSeasonThemes } from './media-page-format';
import type { MediaTheme } from '../../../lib/tauri';

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

describe('mergeSeasonThemes', () => {
  const theme = (external_id: string, theme_type: 'OP' | 'ED', sequence: number, song_title: string | null, slug = `${theme_type}${sequence}`): MediaTheme =>
    ({ external_id, theme_type, sequence, song_title, slug, artists: null, episodes: null, video_url: null });

  it('keeps the first season\'s copy of a song repeated at the same slot', () => {
    const merged = mergeSeasonThemes([
      [theme('anime:1', 'OP', 1, 'Song A')],
      [theme('anime:2', 'OP', 1, 'song a '), theme('anime:2', 'OP', 2, 'Song B')],
    ]);
    expect(merged.map(t => `${t.external_id}:${t.theme_type}${t.sequence}`)).toEqual(['anime:1:OP1', 'anime:2:OP2']);
  });

  it('orders OPs before EDs and by sequence within each type', () => {
    const merged = mergeSeasonThemes([
      [theme('anime:1', 'ED', 2, 'E2'), theme('anime:1', 'OP', 2, 'O2')],
      [theme('anime:2', 'OP', 1, 'O1'), theme('anime:2', 'ED', 1, 'E1')],
    ]);
    expect(merged.map(t => `${t.theme_type}${t.sequence}`)).toEqual(['OP1', 'OP2', 'ED1', 'ED2']);
  });

  it('falls back to the slug when a theme has no song title', () => {
    const merged = mergeSeasonThemes([
      [theme('anime:1', 'OP', 1, null, 'OP1')],
      [theme('anime:2', 'OP', 1, null, 'OP1'), theme('anime:2', 'OP', 1, null, 'OP1-alt')],
    ]);
    expect(merged.map(t => `${t.external_id}:${t.slug}`)).toEqual(['anime:1:OP1', 'anime:2:OP1-alt']);
  });

  it('is empty for no lists', () => {
    expect(mergeSeasonThemes([])).toEqual([]);
  });
});
