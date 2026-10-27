import { describe, expect, it } from 'vitest';

// `import(/* @vite-ignore */ '../lib/x')` or `'@tauri-apps/api/event'` is left
// unresolved by the production build: the relative path 404s and the bare
// specifier has no import map in the Tauri webview. Startup community sync,
// the activity-feed refresh and several Tauri event listeners silently failed
// that way. Only a runtime-computed URL may skip Vite's analysis.
const sources = import.meta.glob<string>(
  ['/src/**/*.{ts,tsx,astro}', '!/src/**/*.test.{ts,tsx}'],
  { query: '?raw', import: 'default', eager: true },
);
const IGNORED_STATIC_IMPORT = /import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*['"`]/;

describe('dynamic imports', () => {
  it('never hide a literal specifier from Vite with @vite-ignore', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    const offenders = Object.entries(sources)
      .filter(([, text]) => IGNORED_STATIC_IMPORT.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
