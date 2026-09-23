import { describe, it, expect } from 'vitest';
import { UI_SCALE_PRESETS, computeUiScale, parseUiScalePreference } from './ui-scale';
import {
  INLINE_COMPUTE_UI_SCALE_SOURCE,
  UI_SCALE_PENDING_CLASS,
  buildUiScaleBootstrapScript,
} from './ui-scale-bootstrap';

type InlineCompute = (raw: string | null, baseWidth: number) => number;

// Evaluates the exact source string that ends up in the <head> script.
const inlineCompute = new Function(`return (${INLINE_COMPUTE_UI_SCALE_SOURCE});`)() as InlineCompute;

const RAWS: Array<string | null> = [null, '', 'auto', '42', ...UI_SCALE_PRESETS.map(String)];
const WIDTHS = [0, 640, 800, 1194, 1280, 1366, 1536, 1600, 1919, 1920, 2560, 3840, Number.NaN];

describe('inline computeUiScale', () => {
  it('agrees with computeUiScale for every preference and width', () => {
    for (const raw of RAWS) {
      for (const width of WIDTHS) {
        expect(inlineCompute(raw, width)).toBe(computeUiScale(parseUiScalePreference(raw), width));
      }
    }
  });
});

interface RunOptions {
  tauri?: boolean;
  preference?: string | null;
  mainZoom?: string | null;
  recordedZoom?: string | null;
  innerWidth: number;
  mode?: 'window' | 'follow-main';
}

async function run({
  tauri = true, preference = null, mainZoom = null, recordedZoom = null, innerWidth, mode = 'window',
}: RunOptions) {
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  if (preference !== null) local.set('pref', preference);
  if (mainZoom !== null) local.set('main', mainZoom);
  if (recordedZoom !== null) session.set('webview', recordedZoom);
  const storage = (map: Map<string, string>) => ({
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
  });
  const classes = new Set<string>();
  const zooms: number[] = [];
  const fakeWindow = {
    innerWidth,
    __TAURI__: tauri
      ? {
        webview: {
          getCurrentWebview: () => ({
            setZoom: (zoom: number) => {
              zooms.push(zoom);
              return Promise.resolve();
            },
          }),
        },
      }
      : undefined,
  };
  const fakeDocument = {
    documentElement: {
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
    },
  };
  const script = buildUiScaleBootstrapScript({
    preferenceKey: 'pref', mainZoomKey: 'main', webviewZoomKey: 'webview', mode,
  });
  new Function('window', 'document', 'localStorage', 'sessionStorage', 'setTimeout', 'requestAnimationFrame', script)(
    fakeWindow, fakeDocument, storage(local), storage(session), () => 0, (cb: () => void) => cb(),
  );
  const pendingDuringCall = classes.has(UI_SCALE_PENDING_CLASS);
  await Promise.resolve();
  await Promise.resolve();
  return { zooms, local, session, pendingDuringCall, pendingAfter: classes.has(UI_SCALE_PENDING_CLASS) };
}

describe('buildUiScaleBootstrapScript', () => {
  it('does nothing outside Tauri', async () => {
    const result = await run({ tauri: false, innerWidth: 1366 });
    expect(result.zooms).toEqual([]);
    expect(result.pendingDuringCall).toBe(false);
  });

  it('does nothing when a fresh webview already has the right zoom', async () => {
    const result = await run({ innerWidth: 1920 });
    expect(result.zooms).toEqual([]);
    expect(result.pendingDuringCall).toBe(false);
  });

  it('zooms a fresh 1366 px window before paint and records it', async () => {
    const result = await run({ innerWidth: 1366 });
    expect(result.zooms).toEqual([0.711]);
    expect(result.pendingDuringCall).toBe(true);
    expect(result.pendingAfter).toBe(false);
    expect(result.session.get('webview')).toBe('0.711');
    expect(result.local.get('main')).toBe('0.711');
  });

  it('keeps an already-applied zoom across navigations (innerWidth is in zoomed px)', async () => {
    // A 1366 px window at zoom 0.711 reports innerWidth ≈ 1921.
    const result = await run({ innerWidth: 1921, recordedZoom: '0.711' });
    expect(result.zooms).toEqual([]);
    expect(result.pendingDuringCall).toBe(false);
  });

  it('applies a fixed preference', async () => {
    const result = await run({ innerWidth: 2560, preference: '125' });
    expect(result.zooms).toEqual([1.25]);
  });

  it('makes the player overlay follow the main window zoom', async () => {
    const result = await run({ innerWidth: 900, mode: 'follow-main', mainZoom: '0.8' });
    expect(result.zooms).toEqual([0.8]);
    expect(result.local.get('main')).toBe('0.8');
    const unchanged = await run({ innerWidth: 900, mode: 'follow-main' });
    expect(unchanged.zooms).toEqual([]);
  });
});
