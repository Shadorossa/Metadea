import { es } from './es';
import { en } from './en';
import type { Locale } from './index';

export function getLangCode(): string {
  return document.documentElement.lang || 'es';
}

export function getT() {
  const lang = getLangCode() as Locale;
  return lang === 'en' ? en : es;
}
