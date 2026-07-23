import { getLangCode } from '../../i18n/client';

export interface DateParts {
  year: number | null | undefined;
  month?: number | null;
  day?: number | null;
}

/** Convert a Unix timestamp (seconds) to a { year, month, day } triple (UTC). */
export function unixToDateParts(unixSeconds: number): DateParts {
  const d = new Date(unixSeconds * 1000);
  // All three fields must come from the same clock — year used to be read
  // via getFullYear() (local time) while month/day used getUTCMonth()/
  // getUTCDate(), so for any timezone other than UTC+0, a release date near
  // a year boundary (e.g. Dec 31 UTC) could pair the wrong year with the
  // right month/day, or vice versa.
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
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

// Look up a translated label by an API key in an i18n dictionary
export function lookupLabel(dict: Record<string, string>, key: string | null | undefined, fallback: string): string {
  return (key ? dict[key] : undefined) ?? fallback;
}

/** Turn an ISO 3166-1 country code (e.g. "JP") into its localized display
 *  name via the platform's own Intl data, instead of maintaining our own
 *  code→name map. Falls back to the raw code if Intl can't resolve it. */
export function countryName(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames([getLangCode()], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Pick the entry matching a preferred country code (default "US"), or the
 *  first entry if no match — used for TMDB's per-country age ratings, which
 *  have no single global value. */
export function pickPreferredCountry<T extends { iso_3166_1: string }>(
  entries: T[] | undefined,
  preferred = 'US',
): T | undefined {
  if (!entries?.length) return undefined;
  return entries.find(e => e.iso_3166_1 === preferred) ?? entries[0];
}

/** Collapses same-family platform entries that only differ by a trailing
 *  generation number — ["PlayStation 4", "PlayStation 5"] becomes
 *  "PlayStation 4/5", ["PlayStation 2", "PlayStation 4", "PlayStation 5"]
 *  becomes "PlayStation 2/4/5" — instead of listing each generation as its
 *  own separate line. Platforms without a trailing number (e.g. "PC
 *  (Windows)", "Nintendo Switch") pass through unchanged. Order follows
 *  each group's first appearance in the input. */
export function mergePlatformVersions(platforms: string[]): string[] {
  const order: string[] = [];
  const numbersByBase = new Map<string, string[]>();
  const passthrough: string[] = [];

  for (const p of platforms) {
    const match = p.match(/^(.*\S)\s+(\d+)$/);
    if (!match) {
      passthrough.push(p);
      continue;
    }
    const [, base, num] = match;
    if (!numbersByBase.has(base)) {
      numbersByBase.set(base, []);
      order.push(base);
    }
    const nums = numbersByBase.get(base)!;
    if (!nums.includes(num)) nums.push(num);
  }

  const merged = order.map(base => `${base} ${numbersByBase.get(base)!.sort((a, b) => Number(a) - Number(b)).join('/')}`);
  return [...merged, ...passthrough];
}

// Parse external_id (e.g. "anime:123") into type and numeric ID
export function parseExternalId(externalId: string): { type: string; id: number } {
  const colonIdx = externalId.indexOf(':');
  const type = externalId.slice(0, colonIdx).split('_')[0];
  const id = parseInt(externalId.slice(colonIdx + 1), 10);
  return { type, id };
}


// Create a sort key [year, month, day] for comparisons (unknowns sorted last)
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

/** Newest-first version of compareByReleaseDate — unlike a plain sign flip,
 *  entries with no known date still sort last instead of jumping to the
 *  front (getReleaseDateKey's Infinity-for-unknown convention only reads as
 *  "last" for ascending order). Used for "recent appearances" style lists. */
export function compareByReleaseDateDesc<T extends { release_year?: number | null; release_month?: number | null; release_day?: number | null; id?: string }>(a: T, b: T): number {
  const keyA = getReleaseDateKey(a);
  const keyB = getReleaseDateKey(b);
  const aUnknown = keyA[0] === Infinity;
  const bUnknown = keyB[0] === Infinity;
  if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
  if (keyA[0] !== keyB[0]) return keyB[0] - keyA[0];
  if (keyA[1] !== keyB[1]) return keyB[1] - keyA[1];
  if (keyA[2] !== keyB[2]) return keyB[2] - keyA[2];
  return (a.id || '').localeCompare(b.id || '');
}

/** Map AniList type/format to internal media types ('anime', 'lnovel', 'manga'). */
export function mapExternalFormatToType(type: string | null | undefined, format: string | null | undefined): 'anime' | 'lnovel' | 'manga' {
  const lowerType = type?.toLowerCase();
  if (lowerType === 'anime') return 'anime';
  if (format === 'NOVEL') return 'lnovel';
  return 'manga';
}

