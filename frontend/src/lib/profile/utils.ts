import { getT, getLangCode } from '../../i18n/client';

export function typeLabel(t: string): string {
  const types = getT().search.types as Record<string, string>;
  return types[t] ?? t;
}

export function statusLabel(s: string): string {
  const p = getT().profile as Record<string, string>;
  return p[`status_${s}`] ?? s;
}

export function pad(n: number): string {
  if (n < 10)  return '00' + n;
  if (n < 100) return '0'  + n;
  return String(n);
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const [, p] = token.split('.');
    return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return {}; }
}

/** "14 ene", "3 mar", etc. — for activity cards */
export function formatShortDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString(getLangCode(), { day: 'numeric', month: 'short' });
}

/** "ENE", "FEB", etc. — for monthly history badges */
export function formatMonthLabel(year: number, month: number): string {
  return new Date(year, month - 1)
    .toLocaleDateString(getLangCode(), { month: 'short' })
    .toUpperCase()
    .replace('.', '');
}
