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

export function formatMonthYear(date: Date): string {
  return date.toLocaleDateString(getLocaleCode(), { month: 'long', year: 'numeric' });
}

export function formatUnixTimestampShort(unixSeconds?: number): string | null {
  if (!unixSeconds) return null;
  return formatDateShort(new Date(unixSeconds * 1000));
}
