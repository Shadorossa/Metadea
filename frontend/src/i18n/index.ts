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
import type { Translations } from './types';
export type { Translations };

// Each locale is annotated `: Translations` in its own file, so a missing,
// renamed or wrongly-shaped key is a compile error there rather than a
// silent English fallback at runtime. See types.ts for why the leaves are
// widened to `string`.
const translations: Record<Locale, Translations> = {
  es,
  en,
  de,
  ja,
  it,
  fr,
  ca,
  ru,
};

export function useTranslations(locale: Locale) {
  return translations[locale] ?? translations['en'];
}

export function getLang(url: URL): Locale {
  const [, lang] = url.pathname.split('/');
  if ((LOCALES as readonly string[]).includes(lang)) return lang as Locale;
  return 'en';
}
