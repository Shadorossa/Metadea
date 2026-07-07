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
