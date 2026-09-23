import { describe, expect, it, vi } from 'vitest';
import type { UiThemeCss } from '../tauri/ui-themes';
import {
  INITIAL_LOADER_STATE,
  createUiThemeLoader,
  hasThemeChanged,
  reduceLoader,
  type UiThemeLoaderState,
  type UiThemeStyleTarget,
} from './ui-theme-loader';

const payload = (over: Partial<UiThemeCss> = {}): UiThemeCss => ({
  id: 'midnight',
  tier: 'variables',
  variables: { accent: '#abc' },
  css: '',
  mtime: 100,
  ...over,
});

const activeState = (over: Partial<UiThemeLoaderState> = {}): UiThemeLoaderState => ({
  status: 'active',
  themeId: 'midnight',
  mtime: 100,
  css: ':root {\n  --accent: #abc;\n}',
  error: null,
  ...over,
});

describe('hasThemeChanged', () => {
  it('is true from idle, on a new id and on a newer mtime', () => {
    expect(hasThemeChanged(INITIAL_LOADER_STATE, payload())).toBe(true);
    expect(hasThemeChanged(activeState(), payload({ id: 'other' }))).toBe(true);
    expect(hasThemeChanged(activeState(), payload({ mtime: 101 }))).toBe(true);
  });

  it('is false when the same theme has not been touched', () => {
    expect(hasThemeChanged(activeState(), payload())).toBe(false);
  });
});

describe('reduceLoader', () => {
  it('injects on first load and composes the CSS', () => {
    const { state, effect } = reduceLoader(INITIAL_LOADER_STATE, { type: 'loaded', payload: payload({ css: 'a{}' }) });
    expect(effect).toBe('inject');
    expect(state.status).toBe('active');
    expect(state.themeId).toBe('midnight');
    expect(state.mtime).toBe(100);
    expect(state.css).toBe(':root {\n  --accent: #abc;\n}\n\na{}');
  });

  it('does nothing when the poll sees the same mtime', () => {
    const before = activeState();
    const { state, effect } = reduceLoader(before, { type: 'loaded', payload: payload() });
    expect(effect).toBe('none');
    expect(state).toBe(before);
  });

  it('re-injects when the file changed', () => {
    const { state, effect } = reduceLoader(activeState(), { type: 'loaded', payload: payload({ mtime: 250, variables: { accent: 'red' } }) });
    expect(effect).toBe('inject');
    expect(state.mtime).toBe(250);
    expect(state.css).toContain('--accent: red');
  });

  it('removes on deactivate only when something was injected', () => {
    expect(reduceLoader(activeState(), { type: 'no-theme' })).toEqual({ state: INITIAL_LOADER_STATE, effect: 'remove' });
    expect(reduceLoader(INITIAL_LOADER_STATE, { type: 'no-theme' }).effect).toBe('none');
  });

  it('removes a theme that stops loading and remembers the error', () => {
    const { state, effect } = reduceLoader(activeState(), { type: 'failed', themeId: 'midnight', error: 'E_UI_THEME_NOT_FOUND: midnight' });
    expect(effect).toBe('remove');
    expect(state.status).toBe('error');
    expect(state.error).toContain('E_UI_THEME_NOT_FOUND');
    expect(reduceLoader(INITIAL_LOADER_STATE, { type: 'failed', themeId: 'x', error: 'e' }).effect).toBe('none');
  });
});

function fakeTarget() {
  const target: UiThemeStyleTarget & { injected: Array<[string, string]>; removed: number } = {
    injected: [],
    removed: 0,
    inject(id, css) { this.injected.push([id, css]); },
    remove() { this.removed++; },
  };
  return target;
}

describe('createUiThemeLoader', () => {
  it('injects the active theme, then only re-injects when the mtime moves', async () => {
    const target = fakeTarget();
    let mtime = 1;
    const readCss = vi.fn(async (id: string) => payload({ id, mtime }));
    const loader = createUiThemeLoader({ target, getActive: async () => 'midnight', readCss });

    await loader.sync();
    await loader.sync();
    expect(target.injected).toHaveLength(1);
    mtime = 2;
    await loader.sync();
    expect(target.injected).toHaveLength(2);
    expect(loader.getState().mtime).toBe(2);
  });

  it('removes the style when no theme is active and reapply follows the state', async () => {
    const target = fakeTarget();
    let active: string | null = 'midnight';
    const loader = createUiThemeLoader({ target, getActive: async () => active, readCss: async id => payload({ id }) });
    await loader.sync();
    loader.reapply();
    expect(target.injected).toHaveLength(2);
    active = null;
    await loader.sync();
    expect(target.removed).toBe(1);
    loader.reapply();
    expect(target.removed).toBe(2);
    expect(loader.getState()).toEqual(INITIAL_LOADER_STATE);
  });

  it('treats a read failure as an error and a getActive failure as no theme', async () => {
    const target = fakeTarget();
    const loader = createUiThemeLoader({
      target,
      getActive: async () => 'broken',
      readCss: async () => { throw new Error('E_UI_THEME_MANIFEST_INVALID: x'); },
    });
    await loader.sync();
    expect(loader.getState().status).toBe('error');
    expect(target.removed).toBe(0);

    const failing = createUiThemeLoader({ target, getActive: async () => { throw new Error('offline'); }, readCss: async id => payload({ id }) });
    await failing.sync();
    expect(failing.getState()).toEqual(INITIAL_LOADER_STATE);
  });

  it('lets the newest sync win when reads overlap', async () => {
    const target = fakeTarget();
    let resolveSlow: (value: UiThemeCss) => void = () => {};
    const slow = new Promise<UiThemeCss>(resolve => { resolveSlow = resolve; });
    let call = 0;
    const loader = createUiThemeLoader({
      target,
      getActive: async () => 'midnight',
      readCss: () => (++call === 1 ? slow : Promise.resolve(payload({ mtime: 9 }))),
    });
    const first = loader.sync();
    // Let the first sync get past getActive() and into its (slow) read
    // before the second one starts, so both reads are genuinely in flight.
    await new Promise(resolve => setTimeout(resolve, 0));
    const second = loader.sync();
    await second;
    resolveSlow(payload({ mtime: 1 }));
    await first;
    expect(target.injected).toHaveLength(1);
    expect(loader.getState().mtime).toBe(9);
  });
});
