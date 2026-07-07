import { getLangCode } from '../../i18n/client';

export interface DateParts {
  year: number | null | undefined;
  month?: number | null;
  day?: number | null;
}

/** Convert a Unix timestamp (seconds) to a { year, month, day } triple (UTC). */
export function unixToDateParts(unixSeconds: number): DateParts {
  const d = new Date(unixSeconds * 1000);
  return { year: d.getFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Format a date triple using the active UI locale. */
export function formatDateParts(
  d: DateParts | null | undefined,
  opts: { monthStyle?: 'short' | 'long'; requireDay?: boolean } = {},
): string {
  if (!d?.year) return '';
  if (!d.month) return String(d.year);
  const { monthStyle = 'long', requireDay = false } = opts;
  const date = new Date(d.year, d.month - 1, d.day ?? 1);
  return date.toLocaleDateString(getLangCode(), {
    year: 'numeric',
    month: monthStyle,
    day: (requireDay || d.day) ? 'numeric' : undefined,
  });
}

/** Normalize a 0-100 score to a 0-10 scale, rounded to 1 decimal. Falsy input (0/undefined) yields undefined. */
export function normalizeScore100(raw: number | undefined | null): number | undefined {
  if (!raw) return undefined;
  return Math.round((raw / 10) * 10) / 10;
}

/**
 * Look up a translated label by a runtime API value (e.g. AniList's
 * 'RELEASING', 'ADAPTATION') in an i18n dict keyed by those same enum-like
 * strings. Centralizes the `as Record<string, string>` cast that dict lookups
 * by a dynamic key would otherwise need at every call site.
 */
export function lookupLabel(dict: Record<string, string>, key: string | null | undefined, fallback: string): string {
  return (key ? dict[key] : undefined) ?? fallback;
}

/** Parse external_id (e.g. "anime:123", "game_igdb:456") into type and numeric ID. */
export function parseExternalId(externalId: string): { type: string; id: number } {
  const colonIdx = externalId.indexOf(':');
  const type = externalId.slice(0, colonIdx).split('_')[0];
  const id = parseInt(externalId.slice(colonIdx + 1), 10);
  return { type, id };
}

/** Extract just the numeric ID from external_id. */
export function extractNumericId(externalId: string): number {
  const colonIdx = externalId.indexOf(':');
  return parseInt(externalId.slice(colonIdx + 1), 10);
}

/** Create a sort key for release date (year, month, day) for use in comparisons.
 *  Returns [year, month, day] with Infinity for missing values to sort unknowns last. */
export function getReleaseDateKey(item: { release_year?: number | null; release_month?: number | null; release_day?: number | null }): [number, number, number] {
  return [
    item.release_year ?? Infinity,
    item.release_month ?? Infinity,
    item.release_day ?? Infinity,
  ];
}

/** Compare two items by their release dates (year, month, day, then by ID as tiebreaker). */
export function compareByReleaseDate<T extends { release_year?: number | null; release_month?: number | null; release_day?: number | null; id?: string }>(a: T, b: T): number {
  const keyA = getReleaseDateKey(a);
  const keyB = getReleaseDateKey(b);
  if (keyA[0] !== keyB[0]) return keyA[0] - keyB[0];
  if (keyA[1] !== keyB[1]) return keyA[1] - keyB[1];
  if (keyA[2] !== keyB[2]) return keyA[2] - keyB[2];
  return (a.id || '').localeCompare(b.id || '');
}
