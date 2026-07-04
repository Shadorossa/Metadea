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
  const { monthStyle = 'short', requireDay = false } = opts;
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
