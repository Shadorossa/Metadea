import { es } from './es';
import { en } from './en';
import { de } from './de';
import { ja } from './ja';
import { it } from './it';
import { fr } from './fr';
import { ca } from './ca';
import { ru } from './ru';
import { LOCALES, type Locale, type Translations } from './index';
import { STORAGE_KEYS } from '../lib/storage/storage-keys';

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T extends object>(fallback: T, target: unknown): T {
  if (!target || typeof target !== 'object') return fallback;
  const source = target as PlainObject;
  const fallbackRecord = fallback as PlainObject;
  const result: PlainObject = Array.isArray(fallback)
    ? ([...fallback] as unknown as PlainObject)
    : { ...fallbackRecord };
  for (const key of Object.keys(source)) {
    const val = source[key];
    const fbVal = fallbackRecord[key];
    if (val !== undefined) {
      if (isPlainObject(val) && isPlainObject(fbVal)) {
        result[key] = deepMerge(fbVal, val);
      } else {
        result[key] = val;
      }
    }
  }
  return result as T;
}

const rawTranslations: Record<Locale, Translations> = {
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
  // en.ts is the reference locale: a key another locale lacks falls back to English.
  translations[locale] = locale === 'en' ? en : deepMerge(en, rawTranslations[locale]);
}

// The language picked in Settings wins; otherwise the system language when
// the app ships it (navigator.languages in preference order, matched on the
// base code: 'es-MX' → 'es'); otherwise English, the reference locale.
export function resolveLangCode(stored: string | null, systemLanguages: readonly string[]): Locale {
  const supported = LOCALES as readonly string[];
  if (stored && supported.includes(stored)) return stored as Locale;
  for (const tag of systemLanguages) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (supported.includes(base)) return base as Locale;
  }
  return 'en';
}

export function getLangCode(): string {
  if (typeof window === 'undefined') return 'en';
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(STORAGE_KEYS.locale); } catch { /* storage unavailable */ }
  const system = navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
  return resolveLangCode(stored, system);
}

export function getT(): Translations {
  const lang = getLangCode() as Locale;
  return translations[lang] ?? en;
}
