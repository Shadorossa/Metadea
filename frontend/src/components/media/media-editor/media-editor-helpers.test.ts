import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MIN_DATE_YEAR,
  clampDateMinYear,
  clampNotBefore,
  extractExternalIdFromRelationUrl,
  editionTabLabel,
  formatSeasonTabLabel,
  formatHoursColon,
  parseHoursColonInput,
  isFutureDate,
} from './media-editor-helpers';

describe('clampDateMinYear', () => {
  it.each([
    ['leaves an empty value alone', '', ''],
    ['pulls a year below the floor up to it, keeping month and day', '1912-07-04', `${MIN_DATE_YEAR}-07-04`],
    ['leaves a year on the floor untouched', `${MIN_DATE_YEAR}-01-01`, `${MIN_DATE_YEAR}-01-01`],
    ['leaves a year above the floor untouched', '2024-03-09', '2024-03-09'],
  ])('%s', (_name, input, expected) => {
    expect(clampDateMinYear(input)).toBe(expected);
  });
});

describe('clampNotBefore', () => {
  it.each([
    ['raises a value that falls before the floor', '2024-01-01', '2024-06-01', '2024-06-01'],
    ['keeps a value on the floor', '2024-06-01', '2024-06-01', '2024-06-01'],
    ['keeps a value after the floor', '2024-12-31', '2024-06-01', '2024-12-31'],
    ['passes through an empty value', '', '2024-06-01', ''],
    ['passes through an empty floor', '2024-01-01', '', '2024-01-01'],
  ])('%s', (_name, value, floor, expected) => {
    expect(clampNotBefore(value, floor)).toBe(expected);
  });
});

describe('extractExternalIdFromRelationUrl', () => {
  it.each<[string, string | null | undefined, string | undefined]>([
    ['pulls the id out of a relation link', '/media?id=anime:123', 'anime:123'],
    ['decodes a percent-encoded id', '/media?id=game%3A456', 'game:456'],
    ['stops at the next query parameter', '/media?id=anime:1&tab=cast', 'anime:1'],
    ['returns undefined for null', null, undefined],
    ['returns undefined for undefined', undefined, undefined],
    ['returns undefined for a url with no id', '/media', undefined],
  ])('%s', (_name, url, expected) => {
    expect(extractExternalIdFromRelationUrl(url)).toBe(expected);
  });
});

describe('editionTabLabel', () => {
  it.each<[string, string, string | undefined, string]>([
    ['falls back to the default label for an empty title', '', undefined, 'Edition'],
    ['falls back to a given default label for an empty title', '', 'Edición', 'Edición'],
    ['keeps the whole title when there is no colon', 'Deluxe Edition', undefined, 'Deluxe Edition'],
    ['keeps only what follows the colon', 'Trails in the Sky: 2nd Chapter', undefined, '2nd Chapter'],
    // Documented noise floor: a remainder of 2 characters or less is not a
    // usable tab label, so the full title is kept instead.
    ['keeps the full title for a 2-character remainder', 'Persona: II', undefined, 'Persona: II'],
    ['keeps the full title for a 1-character remainder', 'Persona: A', undefined, 'Persona: A'],
    ['keeps a remainder of exactly 3 characters', 'Persona: III', undefined, 'III'],
  ])('%s', (_name, title, fallback, expected) => {
    expect(editionTabLabel(title, fallback)).toBe(expected);
  });
});

describe('formatSeasonTabLabel', () => {
  it.each<[string, string, string | undefined, string]>([
    ['returns an empty string for an empty title', '', undefined, ''],
    ['prefers what follows the colon', 'Attack on Titan: Final Season', undefined, 'Final Season'],
    // The 2-character noise floor applies to the base-title fallback too: once
    // the colon remainder is rejected, stripping the prefix reaches the same
    // short tail, so the full title is kept rather than a near-blank tab.
    ['keeps the full title when the colon remainder is noise and stripping the base reaches the same tail', 'Attack on Titan: S2', 'Attack on Titan', 'Attack on Titan: S2'],
    ['strips the base title prefix along with a space separator', 'Inazuma Eleven GO Galaxy', 'Inazuma Eleven', 'GO Galaxy'],
    ['strips the base title prefix along with a dash separator', 'Inazuma Eleven — Chrono Stone', 'Inazuma Eleven', 'Chrono Stone'],
    ['matches the base title case-insensitively', 'INAZUMA ELEVEN Chrono Stone', 'inazuma eleven', 'Chrono Stone'],
    ['keeps the full title when stripping leaves 2 characters or less', 'Inazuma Eleven II', 'Inazuma Eleven', 'Inazuma Eleven II'],
    ['ignores a base title that is itself too short to be meaningful', 'AB Chrono Stone', 'AB', 'AB Chrono Stone'],
  ])('%s', (_name, title, base, expected) => {
    expect(formatSeasonTabLabel(title, base)).toBe(expected);
  });
});

describe('formatHoursColon', () => {
  it.each([
    // Documented: an unlogged/zero entry renders blank, not "0:00", so the
    // field can be typed into directly.
    ['renders an empty string for zero', 0, ''],
    ['formats whole hours with zero-padded minutes', 6, '6:00'],
    ['formats a half hour', 6.5, '6:30'],
    ['zero-pads single-digit minutes', 1 + 5 / 60, '1:05'],
    // Rounding 59.7 minutes up must carry into the hour, not print "6:60".
    ['carries into the next hour instead of printing 60 minutes', 6.999, '7:00'],
  ])('%s', (_name, hours, expected) => {
    expect(formatHoursColon(hours)).toBe(expected);
  });
});

describe('parseHoursColonInput', () => {
  it.each([
    ['parses bare hours', '6', 6],
    ['parses hours and minutes', '6:30', 6.5],
    ['trims surrounding whitespace', '  6:30  ', 6.5],
    // Documented: minutes >= 60 are rejected outright, never clamped.
    ['rejects minutes of exactly 60', '6:60', null],
    ['rejects minutes above 60', '6:90', null],
    ['rejects empty input', '', null],
    ['rejects non-numeric input', 'abc', null],
    ['rejects a missing minutes part', '6:', null],
    ['rejects a second colon', '6:5:4', null],
    ['rejects negative hours', '-3', null],
    // A decimal comma is exactly what the "H:MM" format exists to avoid.
    ['rejects a decimal comma', '10,3', null],
  ])('%s: %j', (_name, input, expected) => {
    expect(parseHoursColonInput(input)).toBe(expected);
  });

  it('parses single-digit minutes', () => {
    expect(parseHoursColonInput('1:05')).toBeCloseTo(1 + 5 / 60, 10);
  });

  it('round-trips with formatHoursColon', () => {
    for (const hours of [1, 6.5, 12.25, 99 + 59 / 60]) {
      expect(parseHoursColonInput(formatHoursColon(hours))).toBeCloseTo(hours, 10);
    }
  });
});

describe('isFutureDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const freezeAt = (iso: string) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  };

  it('is false without a year', () => {
    expect(isFutureDate(null, 6, 1)).toBe(false);
    expect(isFutureDate(undefined, 6, 1)).toBe(false);
    expect(isFutureDate(0, 6, 1)).toBe(false);
  });

  it('is true for a date after now', () => {
    freezeAt('2026-06-15T12:00:00');
    expect(isFutureDate(2027, 1, 1)).toBe(true);
  });

  it('is false for a date before now', () => {
    freezeAt('2026-06-15T12:00:00');
    expect(isFutureDate(2025, 12, 31)).toBe(false);
  });

  // Month and day are optional; a bare year means January 1st of that year.
  it('defaults a missing month and day to January 1st', () => {
    freezeAt('2026-06-15T12:00:00');
    expect(isFutureDate(2026, null, null)).toBe(false);
    expect(isFutureDate(2027, null, null)).toBe(true);
  });
});
