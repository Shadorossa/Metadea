// Typography/layout preferences of the EPUB reader (EpubReaderView). Pure:
// the storage is injected so the persistence round-trip is unit-testable
// and the component only ever passes window.localStorage.

export type ReaderTheme = 'paper' | 'sepia' | 'dark' | 'black';
export type ReaderFont = 'serif' | 'sans' | 'lora' | 'baskerville' | 'alegreya' | 'inter';
export type ReaderFlow = 'paginated' | 'scroll';

export interface ReaderPreferences {
  font: ReaderFont;
  /** px */
  fontSize: number;
  /** unitless line-height */
  lineHeight: number;
  /** horizontal page margin, px */
  margin: number;
  theme: ReaderTheme;
  justify: boolean;
  /** apply the book's own stylesheets on top of ours */
  publisherStyles: boolean;
  flow: ReaderFlow;
}

export const READER_PREFERENCES_KEY = 'metadea_reader_preferences';

export const READER_THEMES: readonly ReaderTheme[] = ['paper', 'sepia', 'dark', 'black'];
export const READER_FONTS: readonly ReaderFont[] = ['serif', 'sans', 'lora', 'baskerville', 'alegreya', 'inter'];
export const READER_FLOWS: readonly ReaderFlow[] = ['paginated', 'scroll'];

export const FONT_SIZE_RANGE = { min: 12, max: 36, step: 1 } as const;
export const LINE_HEIGHT_RANGE = { min: 1.1, max: 2.4, step: 0.1 } as const;
export const MARGIN_RANGE = { min: 0, max: 160, step: 8 } as const;

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  font: 'serif',
  fontSize: 19,
  lineHeight: 1.6,
  margin: 48,
  theme: 'dark',
  justify: true,
  publisherStyles: true,
  flow: 'paginated',
};

// The bundled families are declared in styles/pages/local/base/reader-epub.css.
export const FONT_STACKS: Record<ReaderFont, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  lora: "'Metadea Reader Lora', Georgia, serif",
  baskerville: "'Metadea Reader Baskerville', Georgia, serif",
  alegreya: "'Metadea Reader Alegreya', Georgia, serif",
  inter: "'Metadea Reader Inter', system-ui, sans-serif",
};

export interface ThemePalette {
  background: string;
  foreground: string;
  muted: string;
  link: string;
}

export const THEME_PALETTES: Record<ReaderTheme, ThemePalette> = {
  paper: { background: '#f7f4ec', foreground: '#1f1d1a', muted: '#6b665d', link: '#8a4b12' },
  sepia: { background: '#efe4cf', foreground: '#3b2f1e', muted: '#7a6a4f', link: '#8a4b12' },
  dark: { background: '#15161a', foreground: '#d9d7d1', muted: '#8f8d86', link: '#d7a86e' },
  black: { background: '#000000', foreground: '#c9c7c1', muted: '#77756f', link: '#d7a86e' },
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

function numberOr(value: unknown, fallback: number, range: { min: number; max: number; step: number }): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Number(clamp(roundTo(n, range.step), range.min, range.max).toFixed(2));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Coerces anything (a parsed JSON blob, a partial object, garbage) into
 *  a complete, in-range preferences object. */
export function normalizeReaderPreferences(input: unknown): ReaderPreferences {
  const d = DEFAULT_READER_PREFERENCES;
  const raw = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  return {
    font: oneOf(raw.font, READER_FONTS, d.font),
    fontSize: numberOr(raw.fontSize, d.fontSize, FONT_SIZE_RANGE),
    lineHeight: numberOr(raw.lineHeight, d.lineHeight, LINE_HEIGHT_RANGE),
    margin: numberOr(raw.margin, d.margin, MARGIN_RANGE),
    theme: oneOf(raw.theme, READER_THEMES, d.theme),
    justify: typeof raw.justify === 'boolean' ? raw.justify : d.justify,
    publisherStyles: typeof raw.publisherStyles === 'boolean' ? raw.publisherStyles : d.publisherStyles,
    flow: oneOf(raw.flow, READER_FLOWS, d.flow),
  };
}

export function loadReaderPreferences(storage: StorageLike | null | undefined): ReaderPreferences {
  if (!storage) return { ...DEFAULT_READER_PREFERENCES };
  try {
    const stored = storage.getItem(READER_PREFERENCES_KEY);
    return normalizeReaderPreferences(stored ? JSON.parse(stored) : null);
  } catch {
    return { ...DEFAULT_READER_PREFERENCES };
  }
}

export function saveReaderPreferences(storage: StorageLike | null | undefined, prefs: ReaderPreferences): void {
  if (!storage) return;
  try {
    storage.setItem(READER_PREFERENCES_KEY, JSON.stringify(normalizeReaderPreferences(prefs)));
  } catch {
    // Quota/private-mode failures only lose the preference, never the reading.
  }
}

export function withFontSizeDelta(prefs: ReaderPreferences, delta: number): ReaderPreferences {
  return normalizeReaderPreferences({ ...prefs, fontSize: prefs.fontSize + delta });
}
