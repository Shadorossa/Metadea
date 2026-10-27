import { describe, it, expect } from 'vitest';
import { formatEpisodeNumber, formatThemeEpisodes, mergeSeasonThemes } from './media-page-format';
import type { MediaTheme } from '../../../lib/tauri';

describe('formatEpisodeNumber', () => {
  it.each([
    ['a regular episode as a plain number', 1, '1'],
    ['a two-digit episode as a plain number', 24, '24'],
    // Specials are stored as negative numbers so they sort after the run.
    ['a negative number as a special', -1, 'Sp1'],
    ['a two-digit negative number as a special', -12, 'Sp12'],
    ['zero as a plain number', 0, '0'],
  ])('renders %s', (_name, episode, expected) => {
    expect(formatEpisodeNumber(episode)).toBe(expected);
  });
});

describe('formatThemeEpisodes', () => {
  it.each<[string, string | null | undefined, number, string | null]>([
    ['returns null for null input', null, 0, null],
    ['returns null for undefined input', undefined, 0, null],
    ['returns null for blank input', '   ', 0, null],
    ['trims and passes through with a zero offset', '  1-13  ', 0, '1-13'],
    ['passes through with a negative offset', '1-13', -5, '1-13'],
    ['shifts every number in a range by the offset', '1-13', 24, '25-37'],
    ['shifts a single number by the offset', '5', 10, '15'],
    ['shifts every number in a comma-separated list', '1, 3, 5', 10, '11, 13, 15'],
    // A range already past the offset is absolute, not season-relative, so
    // shifting it again would double-count.
    ['leaves a range that already starts past the offset alone', '25-37', 24, '25-37'],
    ['shifts when the first number equals the offset', '24-30', 24, '48-54'],
    ['passes through text with no numbers', 'ED', 24, 'ED'],
  ])('%s', (_name, episodes, offset, expected) => {
    expect(formatThemeEpisodes(episodes, offset)).toBe(expected);
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
