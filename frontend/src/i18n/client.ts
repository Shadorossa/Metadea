import { es } from './es';
import { en } from './en';
import { de } from './de';
import { ja } from './ja';
import { it } from './it';
import { fr } from './fr';
import { ca } from './ca';
import { ru } from './ru';
import { LOCALES, type Locale, type Translations } from './index';
import { STORAGE_KEYS } from '../lib/shared/storage-keys';

function deepMerge<T extends object>(fallback: T, target: any): T {
  if (!target || typeof target !== 'object') return fallback;
  const result: any = Array.isArray(fallback) ? [...fallback] : { ...fallback };
  for (const key of Object.keys(target)) {
    const val = target[key];
    const fbVal = (fallback as any)[key];
    if (val !== undefined) {
      if (typeof val === 'object' && val !== null && !Array.isArray(val) && typeof fbVal === 'object' && fbVal !== null && !Array.isArray(fbVal)) {
        result[key] = deepMerge(fbVal, val);
      } else {
        result[key] = val;
      }
    }
  }
  return result;
}

const rawTranslations: Record<Locale, any> = {
  es,
  en,
  de,
  ja,
  it,
  fr,
  ca,
  ru,
};

const translations: Record<string, Translations> = {};
for (const locale of LOCALES) {
  translations[locale] = locale === 'es' ? es : deepMerge(es, rawTranslations[locale]);
}

export function getLangCode(): string {
  if (typeof window === 'undefined') return 'es';
  const stored = window.localStorage.getItem(STORAGE_KEYS.locale);
  if (stored && (LOCALES as readonly string[]).includes(stored)) return stored;
  return document.documentElement.lang || 'es';
}

export function getT(): Translations {
  const lang = getLangCode() as Locale;
  return translations[lang] ?? es;
}
