// E-Ink / paper mode of the readers (comic/manga ReaderModal and the EPUB
// reader): a night-reading look modelled on an e-book screen. Pure — the
// palette maths, the SVG filter definition and the preference coercion are
// all unit-tested (eink-mode.test.ts); the components only render what this
// module returns.
//
// Pipeline for page images (comics, PDF canvases, images inside an EPUB),
// applied with CSS `filter: url(#id)` so it runs on the compositor's GPU
// raster path with no per-frame JS:
//   1. feColorMatrix      Rec.709 luminance → grayscale
//   2. feTurbulence       fine fractal noise (≈ 1 CSS px grain), alpha forced to 1
//   3. feComposite        gray + noise, ±½ quantisation step ("paper micro-dither")
//   4. feComponentTransfer discrete, 16 levels (e-ink panels show 16 grays)
//   5. feColorMatrix      gray → ink…paper ramp; blue row 0 once warmth > 0
//   6. feComposite in     restore the source alpha (transparent EPUB PNGs)
// The noise lives in the filtered element's own user space (its border box
// in CSS px), so the dither moves and scales with the page instead of
// shimmering against the screen while it pans or zooms.
//
// Why an SVG filter and not a WebGL shader: measured in the dev webview
// (Chromium) on a 3000×4400 page, the filter costs ≈ +1 ms per raster at
// display size (1080 px tall) and ≈ +3–5 ms at 2160 px, once per page turn
// or resize; the result is cached in the page's layer, so scrolling and
// compositor transforms pay nothing. WebGL redraws are cheaper (< 1 ms) but
// every page needs a full-resolution texture upload (≈ 280 ms setup for
// that page), a canvas per page (losing the <img> context menu / save
// page) and a WebGL context per visible page. The filter only pays for the
// pages in the DOM, which is just the current spread.

export type EinkReaderKind = 'comic' | 'epub';

export interface EinkPreferences {
  enabled: boolean;
  /** 0 = neutral parchment … 1 = amber. Any value > 0 emits no blue at all. */
  warmth: number;
  /** Paper luminance multiplier; lower = dimmer page for a dark room. */
  brightness: number;
  /** Brief inverted flash on page turn, like an e-ink full refresh. */
  refreshFlash: boolean;
}

export const EINK_WARMTH_RANGE = { min: 0, max: 1, step: 0.05 } as const;
export const EINK_BRIGHTNESS_RANGE = { min: 0.35, max: 1, step: 0.05 } as const;

export const DEFAULT_EINK_PREFERENCES: EinkPreferences = {
  enabled: false,
  warmth: 0,
  // Already soft: a parchment page at full brightness is still too much in bed.
  brightness: 0.8,
  refreshFlash: false,
};

/** E-ink panels render 16 gray levels. */
export const EINK_GRAY_LEVELS = 16;

export type Rgb = readonly [number, number, number];

export interface EinkPalette {
  /** 0..1 sRGB */
  paper: Rgb;
  ink: Rgb;
}

// Neutral endpoints: a matte parchment (never #fff) and a warm near-black
// (never #000). The warm range drops blue entirely and pulls green down
// towards an amber page.
const NEUTRAL_PAPER: Rgb = [0.925, 0.894, 0.827];
const NEUTRAL_INK: Rgb = [0.153, 0.137, 0.118];
const WARM_PAPER_LOW: Rgb = [0.93, 0.83, 0];
const WARM_PAPER_HIGH: Rgb = [0.9, 0.55, 0];
const WARM_INK_LOW: Rgb = [0.16, 0.12, 0];
const WARM_INK_HIGH: Rgb = [0.17, 0.08, 0];
/** Amber reads brighter than it measures; full warmth also dims by this much. */
const WARM_DIMMING = 0.12;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

function scaleRgb(c: Rgb, k: number): Rgb {
  return [c[0] * k, c[1] * k, c[2] * k];
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Paper and ink colours for a warmth/brightness pair. */
export function einkPalette(warmth: number, brightness: number): EinkPalette {
  const w = clamp(warmth, EINK_WARMTH_RANGE.min, EINK_WARMTH_RANGE.max);
  const b = clamp(brightness, EINK_BRIGHTNESS_RANGE.min, EINK_BRIGHTNESS_RANGE.max);
  const paper = w > 0 ? lerpRgb(WARM_PAPER_LOW, WARM_PAPER_HIGH, w) : NEUTRAL_PAPER;
  const ink = w > 0 ? lerpRgb(WARM_INK_LOW, WARM_INK_HIGH, w) : NEUTRAL_INK;
  // Dimming scales both ends so the page keeps its contrast ratio.
  const k = b * (1 - WARM_DIMMING * w);
  return { paper: scaleRgb(paper, k), ink: scaleRgb(ink, k) };
}

/** feColorMatrix values mapping a gray input (read from R) onto the
 *  ink → paper ramp: out = ink + gray · (paper − ink). Alpha passes through. */
export function paletteMatrixValues(palette: EinkPalette): number[] {
  const { paper, ink } = palette;
  const row = (i: 0 | 1 | 2) => [round4(paper[i] - ink[i]), 0, 0, 0, round4(ink[i])];
  return [...row(0), ...row(1), ...row(2), 0, 0, 0, 1, 0];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return lerpRgb(a, b, clamp(t, 0, 1));
}

export function rgbToCss(c: Rgb, alpha = 1): string {
  const [r, g, b] = c.map(v => Math.round(clamp(v, 0, 1) * 255));
  return alpha >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ── SVG filter definition ────────────────────────────────────────────────────

export interface FilterPrimitive {
  tag: string;
  attrs: Record<string, string | number>;
  children?: FilterPrimitive[];
}

export interface EinkFilterDefinition {
  id: string;
  attrs: Record<string, string | number>;
  primitives: FilterPrimitive[];
}

export interface EinkFilterOptions {
  id: string;
  palette: EinkPalette;
  levels?: number;
  /** Dither amplitude in quantisation steps (1 = the noise spans about ±½ step). */
  ditherStrength?: number;
  /** feTurbulence baseFrequency in cycles per CSS px (≈ 1 / grain size). */
  grainFrequency?: number;
  seed?: number;
}

const LUMINANCE = [0.2126, 0.7152, 0.0722] as const;

/** `tableValues` of a discrete transfer with `levels` evenly spaced outputs. */
export function discreteTable(levels: number): number[] {
  const n = Math.max(2, Math.round(levels));
  return Array.from({ length: n }, (_, i) => round4(i / (n - 1)));
}

export function buildEinkFilter(options: EinkFilterOptions): EinkFilterDefinition {
  const levels = options.levels ?? EINK_GRAY_LEVELS;
  const step = 1 / (Math.max(2, levels) - 1);
  const strength = options.ditherStrength ?? 1;
  // fractalNoise with one octave clusters around 0.5 within roughly ±0.3,
  // so k3 = 2·step·strength spreads it over about ±0.6 step, centred by k4.
  const k3 = round4(2 * step * strength);
  const k4 = round4(-step * strength);
  const table = discreteTable(levels).join(' ');
  const [lr, lg, lb] = LUMINANCE;
  const gray = [lr, lg, lb, 0, 0, lr, lg, lb, 0, 0, lr, lg, lb, 0, 0, 0, 0, 0, 1, 0];
  return {
    id: options.id,
    attrs: {
      x: 0, y: 0, width: '100%', height: '100%',
      'color-interpolation-filters': 'sRGB',
    },
    primitives: [
      { tag: 'feColorMatrix', attrs: { in: 'SourceGraphic', type: 'matrix', values: gray.join(' '), result: 'gray' } },
      {
        tag: 'feTurbulence',
        attrs: {
          type: 'fractalNoise',
          baseFrequency: options.grainFrequency ?? 0.9,
          numOctaves: 1,
          seed: options.seed ?? 7,
          stitchTiles: 'noStitch',
          result: 'noiseRaw',
        },
      },
      { tag: 'feColorMatrix', attrs: { in: 'noiseRaw', type: 'matrix', values: '1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1', result: 'noise' } },
      { tag: 'feComposite', attrs: { in: 'gray', in2: 'noise', operator: 'arithmetic', k1: 0, k2: 1, k3, k4, result: 'dithered' } },
      {
        tag: 'feComponentTransfer',
        attrs: { in: 'dithered', result: 'quantised' },
        children: (['feFuncR', 'feFuncG', 'feFuncB'] as const).map(tag => ({ tag, attrs: { type: 'discrete', tableValues: table } })),
      },
      { tag: 'feColorMatrix', attrs: { in: 'quantised', type: 'matrix', values: paletteMatrixValues(options.palette).join(' '), result: 'inked' } },
      { tag: 'feComposite', attrs: { in: 'inked', in2: 'SourceAlpha', operator: 'in' } },
    ],
  };
}

function escapeAttr(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function serializeAttrs(attrs: Record<string, string | number>): string {
  return Object.entries(attrs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join('');
}

function serializePrimitive(p: FilterPrimitive): string {
  const inner = p.children?.map(serializePrimitive).join('') ?? '';
  return inner ? `<${p.tag}${serializeAttrs(p.attrs)}>${inner}</${p.tag}>` : `<${p.tag}${serializeAttrs(p.attrs)}/>`;
}

/** `<filter>` markup for an inline `<svg><defs>` (the page's or a shadow root's). */
export function serializeEinkFilter(def: EinkFilterDefinition): string {
  return `<filter id="${escapeAttr(def.id)}"${serializeAttrs(def.attrs)}>${def.primitives.map(serializePrimitive).join('')}</filter>`;
}

/** Static paper grain for text pages: a tiled turbulence tile tinted with the
 *  ink colour at low opacity, as a CSS `url("data:…")` value. */
export function paperGrainDataUri(palette: EinkPalette, opacity = 0.07): string {
  const [r, g, b] = palette.ink.map(v => round4(v));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'>`
    + `<filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/>`
    + `<feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 -1.6 1.25'/></filter>`
    + `<rect width='100%' height='100%' filter='url(#g)' opacity='${round4(opacity)}'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** CSS custom properties the reader chrome reads while E-Ink is on. */
export function einkChromeVars(palette: EinkPalette): Record<string, string> {
  return {
    '--eink-paper': rgbToCss(palette.paper),
    '--eink-paper-shade': rgbToCss(mixRgb(palette.paper, palette.ink, 0.07)),
    '--eink-ink': rgbToCss(palette.ink),
    '--eink-muted': rgbToCss(mixRgb(palette.ink, palette.paper, 0.42)),
    '--eink-line': rgbToCss(mixRgb(palette.paper, palette.ink, 0.28)),
    '--eink-grain': paperGrainDataUri(palette),
  };
}

// ── Preferences ──────────────────────────────────────────────────────────────

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function rangeOr(value: unknown, fallback: number, range: { min: number; max: number; step: number }): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Number(clamp(roundTo(n, range.step), range.min, range.max).toFixed(2));
}

export function normalizeEinkPreferences(input: unknown): EinkPreferences {
  const d = DEFAULT_EINK_PREFERENCES;
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled,
    warmth: rangeOr(raw.warmth, d.warmth, EINK_WARMTH_RANGE),
    brightness: rangeOr(raw.brightness, d.brightness, EINK_BRIGHTNESS_RANGE),
    refreshFlash: typeof raw.refreshFlash === 'boolean' ? raw.refreshFlash : d.refreshFlash,
  };
}
