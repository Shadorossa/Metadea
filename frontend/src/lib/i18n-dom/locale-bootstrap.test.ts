import { describe, it, expect } from 'vitest';
import { resolveLangCode } from '../../i18n/runtime';
import { LOCALES } from '../../i18n/index';
import {
  INLINE_RESOLVE_LOCALE_SOURCE,
  I18N_PENDING_CLASS,
  I18N_PENDING_TIMEOUT_MS,
  buildLocaleBootstrapScript,
  type LocaleBootstrapOptions,
} from './locale-bootstrap';
import { memoryStorage } from '../../../tests/support/memory-storage';

type InlineResolver = (stored: string | null, system: readonly string[], supported: readonly string[]) => string;

// Evaluates the exact source string that ends up in the <head> script.
const inlineResolve = new Function(`return (${INLINE_RESOLVE_LOCALE_SOURCE});`)() as InlineResolver;

const CASES: Array<[stored: string | null, system: string[], expected: string]> = [
  [null, [], 'en'],
  [null, ['es-ES', 'en-US'], 'es'],
  [null, ['es-MX'], 'es'],
  [null, ['ja'], 'ja'],
  [null, ['pt-BR', 'de-AT'], 'de'],
  [null, ['zh-CN', 'ko'], 'en'],
  [null, ['pt-BR', 'ko-KR'], 'en'],
  [null, ['pt-BR', 'es-MX', 'en-US'], 'es'],
  [null, ['EN-gb'], 'en'],
  [null, ['ca_ES'], 'ca'],
  ['fr', ['es-ES'], 'fr'],
  ['ja', ['es-ES'], 'ja'],
  ['en', ['ja-JP'], 'en'],
  ['xx', ['ru-RU'], 'ru'],
  ['xx', ['fr-FR'], 'fr'],
  ['', ['it-IT'], 'it'],
  ['es-ES', ['de'], 'de'],
  ['ES', ['ja'], 'ja'],
  [null, ['', 'fr-CA'], 'fr'],
];

// Settings choice first, then the system languages' base codes in order, then English.
describe('locale resolution', () => {
  it.each(CASES)('stored=%j system=%j resolves to %s in runtime and inline script', (stored, system, expected) => {
    expect(resolveLangCode(stored, system)).toBe(expected);
    expect(inlineResolve(stored, system, LOCALES)).toBe(expected);
  });
});

describe('buildLocaleBootstrapScript', () => {
  function run(storage: Pick<Storage, 'getItem'>, languages: string[], options: Partial<LocaleBootstrapOptions> = {}) {
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    const timers: Array<[() => void, number]> = [];
    const root = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    };
    const script = buildLocaleBootstrapScript({ storageKey: 'metadea_locale', locales: LOCALES, buildLang: 'en', ...options });
    new Function('localStorage', 'navigator', 'document', 'setTimeout', script)(
      storage,
      { languages, language: languages[0] ?? '' },
      { documentElement: root },
      (fn: () => void, ms: number) => timers.push([fn, ms]),
    );
    return { classes, attributes, timers, lang: attributes.get('lang') };
  }

  it('does nothing visible when the resolved locale is the build locale', () => {
    const { classes, attributes, timers } = run(memoryStorage(), ['en-US']);
    expect(attributes.get('lang')).toBe('en');
    expect(classes.size).toBe(0);
    expect(timers).toHaveLength(0);
  });

  it('hides the body with a safety timeout when the locale differs', () => {
    const { classes, attributes, timers } = run(memoryStorage(), ['es-ES']);
    expect(attributes.get('lang')).toBe('es');
    expect(classes.has(I18N_PENDING_CLASS)).toBe(true);
    expect(timers).toHaveLength(1);
    expect(timers[0][1]).toBe(I18N_PENDING_TIMEOUT_MS);
    timers[0][0]();
    expect(classes.has(I18N_PENDING_CLASS)).toBe(false);
  });

  it('prefers the stored Settings choice over the system language', () => {
    const { attributes, classes } = run(memoryStorage({ metadea_locale: 'ja' }), ['es-ES']);
    expect(attributes.get('lang')).toBe('ja');
    expect(classes.has(I18N_PENDING_CLASS)).toBe(true);
  });

  describe('pre-0.7 language migration', () => {
    const MIGRATION = { migratedKey: 'metadea_locale_migrated', legacyLocale: 'es', legacyKeyPrefix: 'metadea_' };

    function runWithStore(initial: Record<string, string>, languages: string[]) {
      const storage = memoryStorage(initial);
      return { store: storage.data, lang: run(storage, languages, MIGRATION).lang };
    }

    it('keeps Spanish for an existing install that never picked a language', () => {
      const { store, lang } = runWithStore({ metadea_rating_system: '10' }, ['en-US']);
      expect(lang).toBe('es');
      expect(store.get('metadea_locale')).toBe('es');
      expect(store.get('metadea_locale_migrated')).toBe('1');
    });

    it('lets a fresh install follow the system language', () => {
      const { store, lang } = runWithStore({}, ['en-US']);
      expect(lang).toBe('en');
      expect(store.has('metadea_locale')).toBe(false);
      expect(store.get('metadea_locale_migrated')).toBe('1');
    });

    it('never overrides a chosen language, and runs only once', () => {
      expect(runWithStore({ metadea_locale: 'fr', metadea_x: '1' }, ['en-US']).lang).toBe('fr');
      const later = runWithStore({ metadea_locale_migrated: '1', metadea_x: '1' }, ['en-US']);
      expect(later.lang).toBe('en');
      expect(later.store.has('metadea_locale')).toBe(false);
    });
  });

  it('survives storage that throws', () => {
    const { lang } = run({ getItem: () => { throw new Error('denied'); } }, ['de-DE'], { storageKey: 'k' });
    expect(lang).toBe('de');
  });
});
