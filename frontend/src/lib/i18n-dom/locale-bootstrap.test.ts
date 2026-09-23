import { describe, it, expect } from 'vitest';
import { resolveLangCode } from '../../i18n/runtime';
import { LOCALES } from '../../i18n/index';
import {
  INLINE_RESOLVE_LOCALE_SOURCE,
  I18N_PENDING_CLASS,
  I18N_PENDING_TIMEOUT_MS,
  buildLocaleBootstrapScript,
} from './locale-bootstrap';

type InlineResolver = (stored: string | null, system: readonly string[], supported: readonly string[]) => string;

// Evaluates the exact source string that ends up in the <head> script.
const inlineResolve = new Function(`return (${INLINE_RESOLVE_LOCALE_SOURCE});`)() as InlineResolver;

const CASES: Array<[stored: string | null, system: string[]]> = [
  [null, []],
  [null, ['es-ES', 'en-US']],
  [null, ['es-MX']],
  [null, ['ja']],
  [null, ['pt-BR', 'de-AT']],
  [null, ['zh-CN', 'ko']],
  [null, ['EN-gb']],
  [null, ['ca_ES']],
  ['fr', ['es-ES']],
  ['en', ['ja-JP']],
  ['xx', ['ru-RU']],
  ['', ['it-IT']],
  ['es-ES', ['de']],
  ['ES', ['ja']],
  [null, ['', 'fr-CA']],
];

describe('inline locale resolver', () => {
  it.each(CASES)('agrees with resolveLangCode for stored=%j system=%j', (stored, system) => {
    expect(inlineResolve(stored, system, LOCALES)).toBe(resolveLangCode(stored, system));
  });
});

describe('buildLocaleBootstrapScript', () => {
  function run(stored: string | null, languages: string[], buildLang = 'en') {
    const classes = new Set<string>();
    const attributes = new Map<string, string>();
    const timers: Array<[() => void, number]> = [];
    const root = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    };
    const script = buildLocaleBootstrapScript({ storageKey: 'metadea_locale', locales: LOCALES, buildLang });
    new Function('localStorage', 'navigator', 'document', 'setTimeout', script)(
      { getItem: (key: string) => (key === 'metadea_locale' ? stored : null) },
      { languages, language: languages[0] ?? '' },
      { documentElement: root },
      (fn: () => void, ms: number) => timers.push([fn, ms]),
    );
    return { classes, attributes, timers };
  }

  it('does nothing visible when the resolved locale is the build locale', () => {
    const { classes, attributes, timers } = run(null, ['en-US']);
    expect(attributes.get('lang')).toBe('en');
    expect(classes.size).toBe(0);
    expect(timers).toHaveLength(0);
  });

  it('hides the body with a safety timeout when the locale differs', () => {
    const { classes, attributes, timers } = run(null, ['es-ES']);
    expect(attributes.get('lang')).toBe('es');
    expect(classes.has(I18N_PENDING_CLASS)).toBe(true);
    expect(timers).toHaveLength(1);
    expect(timers[0][1]).toBe(I18N_PENDING_TIMEOUT_MS);
    timers[0][0]();
    expect(classes.has(I18N_PENDING_CLASS)).toBe(false);
  });

  it('prefers the stored Settings choice over the system language', () => {
    const { attributes, classes } = run('ja', ['es-ES']);
    expect(attributes.get('lang')).toBe('ja');
    expect(classes.has(I18N_PENDING_CLASS)).toBe(true);
  });

  describe('pre-0.7 language migration', () => {
    function runWithStore(initial: Record<string, string>, languages: string[]) {
      const store = new Map(Object.entries(initial));
      const storage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() { return store.size; },
      };
      const attributes = new Map<string, string>();
      const script = buildLocaleBootstrapScript({
        storageKey: 'metadea_locale', locales: LOCALES, buildLang: 'en',
        migratedKey: 'metadea_locale_migrated', legacyLocale: 'es', legacyKeyPrefix: 'metadea_',
      });
      new Function('localStorage', 'navigator', 'document', 'setTimeout', script)(
        storage,
        { languages, language: languages[0] ?? '' },
        { documentElement: { setAttribute: (n: string, v: string) => attributes.set(n, v), classList: { add() {}, remove() {} } } },
        () => {},
      );
      return { store, lang: attributes.get('lang') };
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
    const script = buildLocaleBootstrapScript({ storageKey: 'k', locales: LOCALES, buildLang: 'en' });
    const attributes = new Map<string, string>();
    new Function('localStorage', 'navigator', 'document', 'setTimeout', script)(
      { getItem: () => { throw new Error('denied'); } },
      { languages: ['de-DE'], language: 'de-DE' },
      { documentElement: { setAttribute: (n: string, v: string) => attributes.set(n, v), classList: { add() {}, remove() {} } } },
      () => {},
    );
    expect(attributes.get('lang')).toBe('de');
  });
});
