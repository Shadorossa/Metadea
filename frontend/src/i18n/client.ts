import { es } from './es';
import { en } from './en';
import type { Locale } from './index';

export function getLangCode(): string {
  if (typeof document === 'undefined') return 'es';
  return document.documentElement.lang || 'es';
}

export function getT() {
  const lang = getLangCode() as Locale;
  return lang === 'en' ? en : es;
}
