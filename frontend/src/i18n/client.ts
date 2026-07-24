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

// Astro's own i18n URL-prefix routing (see index.ts's getLang()) never
// actually produces per-locale static pages for this app's `output: 'static'`
// Tauri build — there is no /en/, /de/, etc. route to navigate to, so every
// server-rendered .astro page is always built in Spanish regardless of that
// mechanism. React islands are the one place a runtime language switch is
// actually possible, so they read the user's chosen locale straight from
// localStorage instead of the (always-'es') <html lang> attribute.
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
