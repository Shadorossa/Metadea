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
  it('leaves an empty value alone', () => {
    expect(clampDateMinYear('')).toBe('');
  });

  it('pulls a year below the floor up to it, keeping month and day', () => {
    expect(clampDateMinYear('1912-07-04')).toBe(`${MIN_DATE_YEAR}-07-04`);
  });

  it('leaves a year on or above the floor untouched', () => {
    expect(clampDateMinYear(`${MIN_DATE_YEAR}-01-01`)).toBe(`${MIN_DATE_YEAR}-01-01`);
    expect(clampDateMinYear('2024-03-09')).toBe('2024-03-09');
  });
});

describe('clampNotBefore', () => {
  it('raises a value that falls before the floor', () => {
    expect(clampNotBefore('2024-01-01', '2024-06-01')).toBe('2024-06-01');
  });

  it('keeps a value on or after the floor', () => {
    expect(clampNotBefore('2024-06-01', '2024-06-01')).toBe('2024-06-01');
    expect(clampNotBefore('2024-12-31', '2024-06-01')).toBe('2024-12-31');
  });

  it('passes through when either side is empty', () => {
    expect(clampNotBefore('', '2024-06-01')).toBe('');
    expect(clampNotBefore('2024-01-01', '')).toBe('2024-01-01');
  });
});

describe('extractExternalIdFromRelationUrl', () => {
  it('pulls the id out of a relation link', () => {
    expect(extractExternalIdFromRelationUrl('/media?id=anime:123')).toBe('anime:123');
  });

  it('decodes a percent-encoded id', () => {
    expect(extractExternalIdFromRelationUrl('/media?id=game%3A456')).toBe('game:456');
  });

  it('stops at the next query parameter', () => {
    expect(extractExternalIdFromRelationUrl('/media?id=anime:1&tab=cast')).toBe('anime:1');
  });

  it('returns undefined for null, undefined or a url with no id', () => {
    expect(extractExternalIdFromRelationUrl(null)).toBeUndefined();
    expect(extractExternalIdFromRelationUrl(undefined)).toBeUndefined();
    expect(extractExternalIdFromRelationUrl('/media')).toBeUndefined();
  });
});

describe('editionTabLabel', () => {
  it('falls back to the default label for an empty title', () => {
    expect(editionTabLabel('')).toBe('Edition');
    expect(editionTabLabel('', 'Edición')).toBe('Edición');
  });

  it('keeps the whole title when there is no colon', () => {
    expect(editionTabLabel('Deluxe Edition')).toBe('Deluxe Edition');
  });

  it('keeps only what follows the colon', () => {
    expect(editionTabLabel('Trails in the Sky: 2nd Chapter')).toBe('2nd Chapter');
  });

  // Documented noise floor: a remainder of 2 characters or less is not a
  // usable tab label, so the full title is kept instead.
  it('keeps the full title when the remainder is 2 characters or less', () => {
    expect(editionTabLabel('Persona: II')).toBe('Persona: II');
    expect(editionTabLabel('Persona: A')).toBe('Persona: A');
  });

  it('keeps a remainder of exactly 3 characters', () => {
    expect(editionTabLabel('Persona: III')).toBe('III');
  });
});

describe('formatSeasonTabLabel', () => {
  it('returns an empty string for an empty title', () => {
    expect(formatSeasonTabLabel('')).toBe('');
  });

  it('prefers what follows the colon', () => {
    expect(formatSeasonTabLabel('Attack on Titan: Final Season')).toBe('Final Season');
  });

  // The 2-character noise floor applies to the base-title fallback too: once
  // the colon remainder is rejected, stripping the prefix reaches the same
  // short tail, so the full title is kept rather than a near-blank tab.
  it('keeps the full title when the colon remainder is noise and stripping the base reaches the same tail', () => {
    expect(formatSeasonTabLabel('Attack on Titan: S2', 'Attack on Titan')).toBe('Attack on Titan: S2');
  });

  it('strips the base title prefix along with its separator', () => {
    expect(formatSeasonTabLabel('Inazuma Eleven GO Galaxy', 'Inazuma Eleven')).toBe('GO Galaxy');
    expect(formatSeasonTabLabel('Inazuma Eleven — Chrono Stone', 'Inazuma Eleven')).toBe('Chrono Stone');
  });

  it('matches the base title case-insensitively', () => {
    expect(formatSeasonTabLabel('INAZUMA ELEVEN Chrono Stone', 'inazuma eleven')).toBe('Chrono Stone');
  });

  it('keeps the full title when stripping leaves 2 characters or less', () => {
    expect(formatSeasonTabLabel('Inazuma Eleven II', 'Inazuma Eleven')).toBe('Inazuma Eleven II');
  });

  it('ignores a base title that is itself too short to be meaningful', () => {
    expect(formatSeasonTabLabel('AB Chrono Stone', 'AB')).toBe('AB Chrono Stone');
  });
});

describe('formatHoursColon', () => {
  // Documented: an unlogged/zero entry renders blank, not "0:00", so the
  // field can be typed into directly.
  it('renders an empty string for zero', () => {
    expect(formatHoursColon(0)).toBe('');
  });

  it('formats whole hours with zero-padded minutes', () => {
    expect(formatHoursColon(6)).toBe('6:00');
  });

  it('formats a half hour', () => {
    expect(formatHoursColon(6.5)).toBe('6:30');
  });

  it('zero-pads single-digit minutes', () => {
    expect(formatHoursColon(1 + 5 / 60)).toBe('1:05');
  });

  // Rounding 59.7 minutes up must carry into the hour, not print "6:60".
  it('carries into the next hour instead of printing 60 minutes', () => {
    expect(formatHoursColon(6.999)).toBe('7:00');
  });
});

describe('parseHoursColonInput', () => {
  it('parses bare hours', () => {
    expect(parseHoursColonInput('6')).toBe(6);
  });

  it('parses hours and minutes', () => {
    expect(parseHoursColonInput('6:30')).toBe(6.5);
  });

  it('parses single-digit minutes', () => {
    expect(parseHoursColonInput('1:05')).toBeCloseTo(1 + 5 / 60, 10);
  });

  it('trims surrounding whitespace', () => {
    expect(parseHoursColonInput('  6:30  ')).toBe(6.5);
  });

  // Documented: minutes >= 60 are rejected outright, never clamped.
  it('rejects minutes of 60 or more rather than clamping', () => {
    expect(parseHoursColonInput('6:60')).toBeNull();
    expect(parseHoursColonInput('6:90')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseHoursColonInput('')).toBeNull();
    expect(parseHoursColonInput('abc')).toBeNull();
    expect(parseHoursColonInput('6:')).toBeNull();
    expect(parseHoursColonInput('6:5:4')).toBeNull();
    expect(parseHoursColonInput('-3')).toBeNull();
    // A decimal comma is exactly what the "H:MM" format exists to avoid.
    expect(parseHoursColonInput('10,3')).toBeNull();
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
