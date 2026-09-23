// The tiny `is:inline` <head> script that runs before first paint: it resolves
// the UI locale with the same rules as resolveLangCode() (i18n/runtime.ts) and,
// when that differs from the locale the static pages were built in, hides the
// body until applyTranslations() has re-translated the server-rendered text —
// so a Spanish user never sees a flash of English chrome.
//
// It can't import anything (it runs before any module), so the resolver is
// kept as source text here; locale-bootstrap.test.ts evaluates this exact
// string and checks it against resolveLangCode() on a table of inputs.

/** Class on <html> while the first client-side translation is pending. */
export const I18N_PENDING_CLASS = 'i18n-pending';

/** The body is revealed after this long even if the translation never ran. */
export const I18N_PENDING_TIMEOUT_MS = 1000;

/**
 * ES5 mirror of resolveLangCode(stored, systemLanguages): stored choice if
 * supported, else the first system language whose base code is supported,
 * else English.
 */
export const INLINE_RESOLVE_LOCALE_SOURCE = `function (stored, systemLanguages, supported) {
  if (stored && supported.indexOf(stored) !== -1) return stored;
  for (var i = 0; i < systemLanguages.length; i++) {
    var base = String(systemLanguages[i]).toLowerCase().split(/[-_]/)[0];
    if (supported.indexOf(base) !== -1) return base;
  }
  return 'en';
}`;

export interface LocaleBootstrapOptions {
  storageKey: string;
  locales: readonly string[];
  buildLang: string;
  /** One-time marker: set on the first run of a build with this bootstrap. */
  migratedKey?: string;
  /** Locale an install from before 0.7 ran in without choosing one (the old
   *  default). Kept for such installs so an update never switches language. */
  legacyLocale?: string;
  /** Prefix of the app's localStorage keys: any present on that first run
   *  means the app was already in use (a fresh install has none yet). */
  legacyKeyPrefix?: string;
}

export function buildLocaleBootstrapScript({
  storageKey, locales, buildLang, migratedKey, legacyLocale, legacyKeyPrefix,
}: LocaleBootstrapOptions): string {
  const migration = migratedKey && legacyLocale && legacyKeyPrefix
    ? `
    if (localStorage.getItem(${JSON.stringify(migratedKey)}) === null) {
      if (stored === null) {
        for (var k = 0; k < localStorage.length; k++) {
          var name = localStorage.key(k);
          if (name && name !== ${JSON.stringify(migratedKey)} && name.indexOf(${JSON.stringify(legacyKeyPrefix)}) === 0) {
            stored = ${JSON.stringify(legacyLocale)};
            localStorage.setItem(${JSON.stringify(storageKey)}, stored);
            break;
          }
        }
      }
      localStorage.setItem(${JSON.stringify(migratedKey)}, '1');
    }`
    : '';
  return `(function () {
  var resolve = ${INLINE_RESOLVE_LOCALE_SOURCE};
  var stored = null;
  try {
    stored = localStorage.getItem(${JSON.stringify(storageKey)});${migration}
  } catch (e) { /* storage unavailable */ }
  var system = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language].filter(Boolean);
  var lang = resolve(stored, system, ${JSON.stringify(locales)});
  var root = document.documentElement;
  root.setAttribute('lang', lang);
  if (lang === ${JSON.stringify(buildLang)}) return;
  root.classList.add(${JSON.stringify(I18N_PENDING_CLASS)});
  setTimeout(function () { root.classList.remove(${JSON.stringify(I18N_PENDING_CLASS)}); }, ${I18N_PENDING_TIMEOUT_MS});
})();`;
}
