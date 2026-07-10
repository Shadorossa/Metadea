import { es } from './es';
import { en } from './en';

export type Locale = 'es' | 'en';
export type Translations = typeof es;

const translations: Record<Locale, Translations> = { es, en: en as unknown as Translations };

export function useTranslations(locale: Locale) {
  return translations[locale] ?? translations['es'];
}

export function getLang(url: URL): Locale {
  const [, lang] = url.pathname.split('/');
  if (lang === 'en') return 'en';
  return 'es';
}
