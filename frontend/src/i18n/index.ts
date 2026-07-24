import { es } from './es';
import { en } from './en';
import { de } from './de';
import { ja } from './ja';
import { it } from './it';
import { fr } from './fr';
import { ca } from './ca';
import { ru } from './ru';

export const LOCALES = ['es', 'en', 'de', 'ja', 'it', 'fr', 'ca', 'ru'] as const;
export type Locale = typeof LOCALES[number];
export type Translations = typeof es;

// es.ts is the source of truth for the shape of Translations (typeof es) —
// every other locale file is cast since TS can't verify their literal string
// values match es's inferred literal types, only that the keys/shape line up.
const translations: Record<Locale, Translations> = {
  es,
  en: en as unknown as Translations,
  de: de as unknown as Translations,
  ja: ja as unknown as Translations,
  it: it as unknown as Translations,
  fr: fr as unknown as Translations,
  ca: ca as unknown as Translations,
  ru: ru as unknown as Translations,
};

export function useTranslations(locale: Locale) {
  return translations[locale] ?? translations['es'];
}

export function getLang(url: URL): Locale {
  const [, lang] = url.pathname.split('/');
  if ((LOCALES as readonly string[]).includes(lang)) return lang as Locale;
  return 'es';
}
