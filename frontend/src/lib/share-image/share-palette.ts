// The share image's colours and fonts come from the active theme (Settings'
// theme picker and UI themes set CSS custom properties on <html>), read at
// export time so the PNG matches what the user sees. Every token falls back
// to Metadea's default when a theme leaves it empty, uses something a canvas
// cannot paint (color-mix(), a gradient) or makes the background see-through.
import type { ShareFonts, SharePalette, PaletteRole } from './share-image-types';
import { colorAlpha, contrastRatio } from './share-color';

export const DEFAULT_SHARE_PALETTE: SharePalette = {
  bg: '#07070e',
  surface: '#191927',
  surfaceAlt: '#13131f',
  text: '#e4e4f0',
  muted: '#8a8aad',
  accent: '#c084fc',
  onAccent: '#ffffff',
  border: 'rgba(255, 255, 255, 0.12)',
};

export const DEFAULT_SHARE_FONTS: ShareFonts = {
  display: 'Georgia, "Times New Roman", serif',
  body: '"Inter", "SF Pro Text", system-ui, -apple-system, "Segoe UI", sans-serif',
};

/** CSS custom properties tried per role, first non-empty valid one wins. */
export const PALETTE_TOKENS: Record<PaletteRole, readonly string[]> = {
  bg: ['--bg-primary', '--bg-base'],
  surface: ['--bg-card'],
  surfaceAlt: ['--bg-elevated'],
  text: ['--text-main'],
  // --text-muted is tuned for small UI text on the app's layered surfaces;
  // on a flat export background it is often too dark, so it is only used
  // when it keeps some contrast (checked below).
  muted: ['--text-muted'],
  accent: ['--accent'],
  onAccent: ['--text-on-accent'],
  border: ['--border-medium', '--border-color'],
};

// Below this the muted text (owner name, footer URL) gets lost on the
// background; the default muted tone is used instead.
const MIN_MUTED_CONTRAST = 3;

export interface PaletteSource {
  /** A custom property's value ('' when unset). */
  get(name: string): string;
  /** Whether a canvas can paint this value. */
  isPaintable(value: string): boolean;
}

export function resolveSharePalette(source: PaletteSource): SharePalette {
  const palette = { ...DEFAULT_SHARE_PALETTE };
  for (const role of Object.keys(PALETTE_TOKENS) as PaletteRole[]) {
    for (const token of PALETTE_TOKENS[role]) {
      const value = source.get(token).trim();
      if (!value || !source.isPaintable(value)) continue;
      // The background must be opaque: a glass theme's translucent surface
      // would come out as a transparent PNG.
      if (role === 'bg' && colorAlpha(value) < 0.95) continue;
      if (role === 'muted') {
        const ratio = contrastRatio(value, palette.bg);
        if (ratio !== null && ratio < MIN_MUTED_CONTRAST) continue;
      }
      palette[role] = value;
      break;
    }
  }
  return palette;
}

/** The live theme's palette. Falls back to defaults outside a browser. */
export function readSharePalette(): SharePalette {
  if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return { ...DEFAULT_SHARE_PALETTE };
  const styles = getComputedStyle(document.documentElement);
  const probe = document.createElement('canvas').getContext('2d');
  return resolveSharePalette({
    get: name => styles.getPropertyValue(name),
    isPaintable: value => {
      if (!probe) return /^(#|rgb|hsl)/i.test(value);
      // An invalid fillStyle is ignored, so paint twice from two different
      // starting points: a valid value lands on the same colour both times.
      probe.fillStyle = '#000000';
      probe.fillStyle = value;
      const first = probe.fillStyle;
      probe.fillStyle = '#ffffff';
      probe.fillStyle = value;
      return first === probe.fillStyle;
    },
  });
}

/** Font stacks the app is using, once its web fonts have loaded. */
export async function readShareFonts(): Promise<ShareFonts> {
  if (typeof document === 'undefined') return { ...DEFAULT_SHARE_FONTS };
  const bodyFamily = getComputedStyle(document.body).fontFamily.trim();
  const displayFamily = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim();
  const fonts: ShareFonts = {
    body: bodyFamily || DEFAULT_SHARE_FONTS.body,
    display: displayFamily || DEFAULT_SHARE_FONTS.display,
  };
  try {
    // A weight the page never used is not fetched yet; ask for the ones
    // the image draws with, then wait for everything in flight.
    await Promise.all(
      [500, 600, 700, 800].map(weight => document.fonts.load(`${weight} 32px ${fonts.body}`).catch(() => [])),
    );
    await document.fonts.ready;
  } catch {
    /* FontFaceSet unavailable: the stacks still name system fallbacks */
  }
  return fonts;
}
