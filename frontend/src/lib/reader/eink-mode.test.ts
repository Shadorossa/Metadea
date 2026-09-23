import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EINK_PREFERENCES,
  EINK_GRAY_LEVELS,
  buildEinkFilter,
  discreteTable,
  einkChromeVars,
  einkPalette,
  normalizeEinkPreferences,
  paletteMatrixValues,
  paperGrainDataUri,
  rgbToCss,
  serializeEinkFilter,
} from './eink-mode';
import { buildReaderStyles } from './epub-chapter-dom';
import { DEFAULT_READER_PREFERENCES } from './reader-preferences';

const blueRow = (values: number[]) => values.slice(10, 15);

describe('einkPalette', () => {
  it('neutral paper is parchment, never white, and ink is never black', () => {
    const { paper, ink } = einkPalette(0, 1);
    expect(Math.max(...paper)).toBeLessThan(1);
    expect(paper[0]).toBeGreaterThan(paper[2]); // warm cast, not gray
    expect(Math.min(...ink)).toBeGreaterThan(0);
  });

  it('any warmth above 0 emits no blue at all', () => {
    for (const w of [0.05, 0.3, 0.6, 1]) {
      const p = einkPalette(w, 1);
      expect(p.paper[2]).toBe(0);
      expect(p.ink[2]).toBe(0);
      expect(blueRow(paletteMatrixValues(p))).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it('more warmth means less green on the paper (towards amber)', () => {
    expect(einkPalette(1, 1).paper[1]).toBeLessThan(einkPalette(0.2, 1).paper[1]);
  });

  it('brightness dims paper and ink together and is clamped', () => {
    const full = einkPalette(0, 1);
    const dim = einkPalette(0, 0.5);
    expect(dim.paper[0]).toBeCloseTo(full.paper[0] * 0.5);
    expect(dim.ink[0]).toBeCloseTo(full.ink[0] * 0.5);
    expect(einkPalette(0, 0).paper[0]).toBeCloseTo(einkPalette(0, 0.35).paper[0]);
    expect(einkPalette(0, 7).paper[0]).toBeCloseTo(full.paper[0]);
  });
});

describe('paletteMatrixValues', () => {
  it('maps gray 0 to ink and gray 1 to paper, reading the R input only', () => {
    const palette = einkPalette(0, 0.8);
    const m = paletteMatrixValues(palette);
    expect(m).toHaveLength(20);
    for (const channel of [0, 1, 2]) {
      const row = m.slice(channel * 5, channel * 5 + 5);
      expect(row.slice(1, 4)).toEqual([0, 0, 0]);
      expect(row[4]).toBeCloseTo(palette.ink[channel], 3); // gray = 0
      expect(row[0] + row[4]).toBeCloseTo(palette.paper[channel], 3); // gray = 1
    }
    expect(m.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });
});

describe('buildEinkFilter', () => {
  const def = buildEinkFilter({ id: 'eink-test', palette: einkPalette(0.5, 0.8) });

  it('runs luminance → noise → dither → 16-level discrete → palette → alpha', () => {
    expect(def.primitives.map(p => p.tag)).toEqual([
      'feColorMatrix', 'feTurbulence', 'feColorMatrix', 'feComposite', 'feComponentTransfer', 'feColorMatrix', 'feComposite',
    ]);
    expect(def.attrs['color-interpolation-filters']).toBe('sRGB');
  });

  it('quantises to 16 evenly spaced levels', () => {
    const transfer = def.primitives[4];
    expect(transfer.children).toHaveLength(3);
    for (const fn of transfer.children ?? []) {
      expect(fn.attrs.type).toBe('discrete');
      const table = String(fn.attrs.tableValues).split(' ').map(Number);
      expect(table).toHaveLength(EINK_GRAY_LEVELS);
      expect(table[0]).toBe(0);
      expect(table[15]).toBe(1);
    }
    expect(discreteTable(4)).toEqual([0, 0.3333, 0.6667, 1]);
  });

  it('centres the dither noise around zero with a sub-step amplitude', () => {
    const composite = def.primitives[3].attrs;
    expect(composite.operator).toBe('arithmetic');
    expect(composite.in).toBe('gray');
    const k3 = Number(composite.k3);
    const k4 = Number(composite.k4);
    expect(k3 * 0.5 + k4).toBeCloseTo(0, 4); // mid-gray noise adds nothing
    expect(k3).toBeLessThan(0.2);
  });

  it('ends with the palette matrix (no blue when warm) and the source alpha', () => {
    const palette = String(def.primitives[5].attrs.values).split(' ').map(Number);
    expect(blueRow(palette)).toEqual([0, 0, 0, 0, 0]);
    expect(def.primitives[6].attrs).toMatchObject({ operator: 'in', in2: 'SourceAlpha' });
  });

  it('serialises to a single <filter> with the id', () => {
    const markup = serializeEinkFilter(def);
    expect(markup.startsWith('<filter id="eink-test"')).toBe(true);
    expect(markup.endsWith('</filter>')).toBe(true);
    expect(markup).toContain('<feFuncR type="discrete"');
    expect(markup).not.toContain('undefined');
  });
});

describe('CSS helpers', () => {
  it('rgbToCss clamps and rounds', () => {
    expect(rgbToCss([1.2, 0.5, -1])).toBe('rgb(255, 128, 0)');
    expect(rgbToCss([0, 0, 0], 0.5)).toBe('rgba(0, 0, 0, 0.5)');
  });

  it('chrome vars and grain carry no blue when warm', () => {
    const vars = einkChromeVars(einkPalette(0.4, 0.8));
    expect(vars['--eink-paper']).toMatch(/, 0\)$/);
    expect(vars['--eink-ink']).toMatch(/, 0\)$/);
    expect(paperGrainDataUri(einkPalette(0.4, 0.8))).toMatch(/^url\("data:image\/svg\+xml,/);
  });
});

describe('EPUB chapter styles', () => {
  it('adds the paper layer only when E-Ink is on', () => {
    const off = buildReaderStyles(DEFAULT_READER_PREFERENCES, 800, 600, 48);
    expect(off).not.toContain('filter: url(');
    const on = buildReaderStyles(DEFAULT_READER_PREFERENCES, 800, 600, 48, { palette: einkPalette(0, 0.8), filterId: 'eink-x' });
    expect(on).toContain('filter: url(#eink-x)');
    expect(on).toContain("'Iowan Old Style'");
    expect(on).toContain('66ch');
    expect(on).toContain('hyphens: auto');
    const einkLayer = on.slice(off.length);
    expect(einkLayer).not.toMatch(/#fff\b|#000\b|rgb\(255, 255, 255\)|rgb\(0, 0, 0\)/);
  });
});

describe('normalizeEinkPreferences', () => {
  it('fills defaults and clamps ranges', () => {
    expect(normalizeEinkPreferences(null)).toEqual(DEFAULT_EINK_PREFERENCES);
    expect(normalizeEinkPreferences({ enabled: true, warmth: 3, brightness: 0.01, refreshFlash: 'yes' })).toEqual({
      enabled: true, warmth: 1, brightness: 0.35, refreshFlash: false,
    });
    expect(normalizeEinkPreferences({ warmth: 0.43 }).warmth).toBe(0.45);
  });
});
