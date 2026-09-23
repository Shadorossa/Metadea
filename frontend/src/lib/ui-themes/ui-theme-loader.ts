// The loader that keeps exactly one `<style id="metadea-ui-theme">` in sync
// with the active UI theme. The reducer and change detection are pure (see
// ui-theme-loader.test.ts); DOM access goes through a small StyleTarget so
// components/ui-themes/UiThemeLoader.tsx is only wiring.
import type { UiThemeCss } from '../tauri/ui-themes';
import { composeThemeCss } from './variables-block';

export const UI_THEME_STYLE_ID = 'metadea-ui-theme';
export const UI_THEME_HTML_ATTR = 'data-ui-theme';
/** Dev-loop poll interval for the "watch for changes" toggle. */
export const UI_THEME_WATCH_INTERVAL_MS = 2000;

export interface UiThemeStyleTarget {
  /** Ensures the style element exists, holds `css`, sits last in <head>
   *  (so it wins the cascade) and tags <html data-ui-theme>. */
  inject(themeId: string, css: string): void;
  remove(): void;
}

export type UiThemeLoaderStatus = 'idle' | 'active' | 'error';

export interface UiThemeLoaderState {
  status: UiThemeLoaderStatus;
  themeId: string | null;
  mtime: number | null;
  /** The composed CSS currently injected (kept to re-inject after a swap). */
  css: string;
  error: string | null;
}

export const INITIAL_LOADER_STATE: UiThemeLoaderState = {
  status: 'idle',
  themeId: null,
  mtime: null,
  css: '',
  error: null,
};

export type UiThemeLoaderEvent =
  | { type: 'no-theme' }
  | { type: 'loaded'; payload: UiThemeCss }
  | { type: 'failed'; themeId: string; error: string };

export type UiThemeLoaderEffect = 'inject' | 'remove' | 'none';

/** A fresh read differs from what is injected when the id or mtime moved. */
export function hasThemeChanged(state: UiThemeLoaderState, payload: Pick<UiThemeCss, 'id' | 'mtime'>): boolean {
  return state.status !== 'active' || state.themeId !== payload.id || state.mtime !== payload.mtime;
}

export function reduceLoader(
  state: UiThemeLoaderState,
  event: UiThemeLoaderEvent,
): { state: UiThemeLoaderState; effect: UiThemeLoaderEffect } {
  switch (event.type) {
    case 'no-theme': {
      const wasInjected = state.status === 'active';
      return { state: { ...INITIAL_LOADER_STATE }, effect: wasInjected ? 'remove' : 'none' };
    }
    case 'loaded': {
      if (!hasThemeChanged(state, event.payload)) return { state, effect: 'none' };
      return {
        state: {
          status: 'active',
          themeId: event.payload.id,
          mtime: event.payload.mtime,
          css: composeThemeCss(event.payload),
          error: null,
        },
        effect: 'inject',
      };
    }
    case 'failed': {
      // A theme that stops loading (deleted folder, broken manifest mid-edit)
      // is removed rather than left half-applied.
      const wasInjected = state.status === 'active';
      return {
        state: { status: 'error', themeId: event.themeId, mtime: null, css: '', error: event.error },
        effect: wasInjected ? 'remove' : 'none',
      };
    }
  }
}

export interface UiThemeLoaderDeps {
  target: UiThemeStyleTarget;
  getActive: () => Promise<string | null>;
  readCss: (id: string) => Promise<UiThemeCss>;
}

export interface UiThemeLoaderController {
  /** Reads the active id + CSS and injects/removes as needed. */
  sync(): Promise<UiThemeLoaderState>;
  /** Re-injects the cached CSS (after Astro swapped <head>). */
  reapply(): void;
  getState(): UiThemeLoaderState;
}

export function createUiThemeLoader(deps: UiThemeLoaderDeps): UiThemeLoaderController {
  let state: UiThemeLoaderState = { ...INITIAL_LOADER_STATE };
  let generation = 0;

  const apply = (event: UiThemeLoaderEvent) => {
    const next = reduceLoader(state, event);
    state = next.state;
    if (next.effect === 'inject' && state.themeId) deps.target.inject(state.themeId, state.css);
    else if (next.effect === 'remove') deps.target.remove();
  };

  return {
    async sync() {
      // A slower earlier sync must not overwrite a newer one's result.
      const mine = ++generation;
      let activeId: string | null;
      try {
        activeId = await deps.getActive();
      } catch {
        activeId = null;
      }
      if (mine !== generation) return state;
      if (!activeId) {
        apply({ type: 'no-theme' });
        return state;
      }
      try {
        const payload = await deps.readCss(activeId);
        if (mine !== generation) return state;
        apply({ type: 'loaded', payload });
      } catch (err) {
        if (mine !== generation) return state;
        apply({ type: 'failed', themeId: activeId, error: err instanceof Error ? err.message : String(err) });
      }
      return state;
    },
    reapply() {
      if (state.status === 'active' && state.themeId) deps.target.inject(state.themeId, state.css);
      else deps.target.remove();
    },
    getState() {
      return state;
    },
  };
}

/** The real DOM target; `doc` is injectable for tests. */
export function createDomStyleTarget(doc: Document): UiThemeStyleTarget {
  return {
    inject(themeId, css) {
      let el = doc.getElementById(UI_THEME_STYLE_ID) as HTMLStyleElement | null;
      if (!el) {
        el = doc.createElement('style');
        el.id = UI_THEME_STYLE_ID;
      }
      el.setAttribute('data-theme-id', themeId);
      if (el.textContent !== css) el.textContent = css;
      // appendChild on an attached node moves it, so the theme always sits
      // after the app's own stylesheets (page CSS included) in the cascade.
      doc.head.appendChild(el);
      doc.documentElement.setAttribute(UI_THEME_HTML_ATTR, themeId);
    },
    remove() {
      doc.getElementById(UI_THEME_STYLE_ID)?.remove();
      doc.documentElement.removeAttribute(UI_THEME_HTML_ATTR);
    },
  };
}
