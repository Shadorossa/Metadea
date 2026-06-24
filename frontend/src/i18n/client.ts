import { es } from './es';
import { en } from './en';
import type { Locale } from './index';

export function getT() {
  const lang = (document.documentElement.lang ?? 'es') as Locale;
  return lang === 'en' ? en : es;
}
