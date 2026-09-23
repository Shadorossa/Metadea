import { describe, it, expect } from 'vitest';
import { es } from '../src/i18n/es';
import { en } from '../src/i18n/en';
import { de } from '../src/i18n/de';
import { ja } from '../src/i18n/ja';
import { it as itLocale } from '../src/i18n/it';
import { fr } from '../src/i18n/fr';
import { ca } from '../src/i18n/ca';
import { ru } from '../src/i18n/ru';

// Cross-cutting test (lives in tests/, not next to a module): es.ts is the source of truth (`type Translations = typeof es`) and the other
// locales are cast, so `tsc` cannot catch a key that is missing, renamed or
// the wrong shape. At runtime deepMerge(es, locale) papers over the gap by
// falling back to Spanish, which is invisible in testing and wrong for the
// user. These tests are the only thing standing in for that type check.
const others: Array<[string, unknown]> = [
  ['en', en], ['de', de], ['ja', ja], ['it', itLocale],
  ['fr', fr], ['ca', ca], ['ru', ru],
];

type Shape = 'string' | 'object' | 'other';

function shapeOf(value: unknown): Shape {
  if (typeof value === 'string') return 'string';
  if (value && typeof value === 'object' && !Array.isArray(value)) return 'object';
  return 'other';
}

function flatten(node: unknown, prefix = '', out = new Map<string, Shape>()): Map<string, Shape> {
  if (shapeOf(node) !== 'object') return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.set(path, shapeOf(value));
    if (shapeOf(value) === 'object') flatten(value, path, out);
  }
  return out;
}

const PLACEHOLDER = /\{[a-zA-Z0-9_]+\}/g;

function hasKey(node: unknown, path: string): boolean {
  let current: unknown = node;
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object' || !(key in current)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

function placeholdersAt(node: unknown, path: string): Set<string> {
  const value = path.split('.').reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
    node,
  );
  return typeof value === 'string' ? new Set(value.match(PLACEHOLDER) ?? []) : new Set();
}

const esKeys = flatten(es);

describe('locale key parity against es', () => {
  it.each(others)('%s has every key es has', (name, locale) => {
    const keys = flatten(locale);
    const missing = [...esKeys.keys()].filter(k => !keys.has(k));
    expect(missing, `${name}.ts is missing ${missing.length} key(s); they will silently render Spanish`).toEqual([]);
  });

  it.each(others)('%s has no keys es does not have', (name, locale) => {
    const keys = flatten(locale);
    const orphans = [...keys.keys()].filter(k => !esKeys.has(k));
    expect(orphans, `${name}.ts has ${orphans.length} orphan key(s); nothing can read them`).toEqual([]);
  });

  it.each(others)('%s matches the shape of es at every key', (name, locale) => {
    const keys = flatten(locale);
    const mismatched = [...keys.entries()]
      .filter(([path, shape]) => esKeys.has(path) && esKeys.get(path) !== shape)
      .map(([path, shape]) => `${path}: es=${esKeys.get(path)} ${name}=${shape}`);
    expect(mismatched, `${name}.ts disagrees with es on the shape of these keys`).toEqual([]);
  });
});

describe('placeholder parity', () => {
  const stringKeys = [...esKeys.entries()].filter(([, shape]) => shape === 'string').map(([path]) => path);

  it.each(others)('%s keeps every {placeholder} es uses', (name, locale) => {
    const broken: string[] = [];
    for (const path of stringKeys) {
      const expected = placeholdersAt(es, path);
      if (expected.size === 0) continue;
      // A key absent from this locale is the parity test's business, not ours;
      // a key that is present but dropped its placeholder is exactly what this
      // test exists to catch, so absence of placeholders is never a skip.
      if (!hasKey(locale, path)) continue;
      const actual = placeholdersAt(locale, path);
      const lost = [...expected].filter(p => !actual.has(p));
      const invented = [...actual].filter(p => !expected.has(p));
      if (lost.length || invented.length) {
        broken.push(`${path} (lost: ${lost.join(',') || '-'}; unknown: ${invented.join(',') || '-'})`);
      }
    }
    expect(broken, `${name}.ts would render literal braces or drop a value for these keys`).toEqual([]);
  });
});

describe('es itself', () => {
  it('has no empty string values', () => {
    const empty = [...esKeys.entries()]
      .filter(([path, shape]) => shape === 'string' && placeholdersAt(es, path).size === 0)
      .filter(([path]) => {
        const value = path.split('.').reduce<any>((acc, k) => acc?.[k], es as any);
        return typeof value === 'string' && value.trim() === '';
      })
      .map(([path]) => path);
    expect(empty).toEqual([]);
  });
});
