// Re-translates server-rendered markup on the client. The static Tauri build
// has no per-locale routes, so every `.astro` page is rendered once, in the
// build locale; elements carry the key they were rendered from and this walks
// them with the runtime locale (see i18n/runtime.ts → getT()).
//
//   data-i18n="nav.home"              → textContent
//   data-i18n-html="help.igdb_body1"  → innerHTML (only for keys whose values
//                                       are trusted static markup in i18n/*.ts)
//   data-i18n-title / -aria-label / -placeholder / -alt → that attribute
//   data-i18n-doc-title="settings.title" on <title> (text) or <meta> (content),
//                                       with optional data-i18n-prefix/-suffix
//   data-i18n-vars='{"count":3}'      → `{count}` interpolation for any of them

type Vars = Record<string, string | number>;

// Attribute-targeting markers. `data-i18n-aria` is the older spelling the
// onboarding page still uses for aria-label.
const ATTRIBUTE_MARKERS: ReadonlyArray<readonly [marker: string, attribute: string]> = [
  ['data-i18n-title', 'title'],
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-aria', 'aria-label'],
  ['data-i18n-placeholder', 'placeholder'],
  ['data-i18n-alt', 'alt'],
];

/** Looks up a dot-path key (`settings.tab_backup`) in a translations object. */
export function resolveTranslationKey(translations: unknown, keyPath: string): string | undefined {
  let value: unknown = translations;
  for (const part of keyPath.split('.')) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' ? value : undefined;
}

/** Replaces `{name}` placeholders present in `vars`; unknown ones are left as-is. */
export function interpolateTranslation(template: string, vars: Vars | null): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

function readVars(el: Element): Vars | null {
  const raw = el.getAttribute('data-i18n-vars');
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Vars) : null;
  } catch {
    return null;
  }
}

function translate(el: Element, marker: string, translations: unknown): string | undefined {
  const key = el.getAttribute(marker);
  if (!key) return undefined;
  const value = resolveTranslationKey(translations, key);
  return value === undefined ? undefined : interpolateTranslation(value, readVars(el));
}

/**
 * Applies `translations` to every `data-i18n*` element under `root`. A key
 * missing from the dictionary leaves the server-rendered text untouched.
 */
export function applyTranslations(root: ParentNode, translations: unknown): void {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const value = translate(el, 'data-i18n', translations);
    if (value === undefined) return;
    // Legacy form: `data-i18n` on a form field targets an attribute
    // (placeholder unless `data-i18n-attr` names another one).
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.setAttribute(el.getAttribute('data-i18n-attr') || 'placeholder', value);
    } else if (el.textContent !== value) {
      el.textContent = value;
    }
  });

  root.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const value = translate(el, 'data-i18n-html', translations);
    if (value !== undefined && el.innerHTML !== value) el.innerHTML = value;
  });

  for (const [marker, attribute] of ATTRIBUTE_MARKERS) {
    root.querySelectorAll(`[${marker}]`).forEach((el) => {
      const value = translate(el, marker, translations);
      if (value !== undefined) el.setAttribute(attribute, value);
    });
  }

  root.querySelectorAll('[data-i18n-doc-title]').forEach((el) => {
    const value = translate(el, 'data-i18n-doc-title', translations);
    if (value === undefined) return;
    const full = (el.getAttribute('data-i18n-prefix') ?? '') + value + (el.getAttribute('data-i18n-suffix') ?? '');
    if (el.tagName === 'META') el.setAttribute('content', full);
    else if (el.textContent !== full) el.textContent = full;
  });
}

/** Translates the whole document and stamps `<html lang>`. */
export function applyDocumentTranslations(doc: Document, translations: unknown, lang: string): void {
  doc.documentElement.setAttribute('lang', lang);
  applyTranslations(doc, translations);
}
