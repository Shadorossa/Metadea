import { describe, it, expect } from 'vitest';
import { en } from '../src/i18n/en';
import { resolveTranslationKey } from '../src/lib/i18n-dom/apply-translations';

// Every literal `data-i18n*="key"` marker in .astro markup must name a real
// string in en.ts (the reference locale): a typo would silently leave the
// server-rendered build-locale text on screen for every other language.
// Vite inlines every .astro source as a string (no node:fs typings here).
const SOURCES = import.meta.glob<string>('../src/**/*.astro', { query: '?raw', import: 'default', eager: true });
const MARKER = /\sdata-i18n(?:-html|-title|-aria-label|-aria|-placeholder|-alt|-doc-title)?="([\w.]+)"/g;

describe('data-i18n markers in .astro files', () => {
  const markers = Object.entries(SOURCES).flatMap(([file, source]) =>
    [...source.matchAll(MARKER)].map((m) => [file, m[1]] as const),
  );

  it('finds markers to check', () => {
    expect(markers.length).toBeGreaterThan(100);
  });

  it('every key resolves to a string in en.ts', () => {
    const missing = markers.filter(([, key]) => resolveTranslationKey(en, key) === undefined);
    expect(missing).toEqual([]);
  });
});
