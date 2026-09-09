import { getLangCode } from '../../i18n/client';

export function getLocaleCode(): string {
  const code = getLangCode();
  const localeMap: Record<string, string> = {
    es: 'es-ES',
    en: 'en-US',
    ja: 'ja-JP',
    de: 'de-DE',
    fr: 'fr-FR',
    it: 'it-IT',
    ca: 'ca-ES',
    ru: 'ru-RU',
  };
  return localeMap[code] || 'es-ES';
}

export function formatDateShort(date: Date): string {
  return date.toLocaleDateString(getLocaleCode(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateLong(date: Date): string {
  return date.toLocaleDateString(getLocaleCode(), { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateNumeric(date: Date): string {
  return date.toLocaleDateString(getLocaleCode(), { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatUnixTimestampShort(unixSeconds?: number): string | null {
  if (!unixSeconds) return null;
  return formatDateShort(new Date(unixSeconds * 1000));
}

// Parses a "YYYY-MM-DD" date string as LOCAL date components — not passed
// straight to `new Date(dateStr)`, which parses as UTC and can shift a day
// depending on the viewer's timezone offset — then formats it long-form.
// Shared by the profile page's "Actividad reciente" (ActivitySection.tsx)
// and Home's own friends-activity feed (ActivityFeedSection.tsx), which
// render the same day-grouped card format over the same date shape.
export function formatLocalDateLong(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return formatDateLong(new Date(Number(year), Number(month) - 1, Number(day)));
}
