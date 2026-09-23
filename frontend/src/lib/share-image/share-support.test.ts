import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHARE_PALETTE, resolveSharePalette } from './share-palette';
import { colorAlpha, contrastRatio, contrastTextColor } from './share-color';
import { bingoImageFileName, slugifyFileName, tierListImageFileName } from './share-output';
import { classifyImageSource, createShareImageLoader, layoutImageSources, mapWithConcurrency } from './share-assets';
import { wrapText } from './share-draw';
import type { ShareLayout } from './share-image-types';

const paintable = (value: string) => /^(#|rgb|hsl)/i.test(value);

describe('share palette', () => {
  it('falls back to Metadea defaults when the theme sets nothing', () => {
    expect(resolveSharePalette({ get: () => '', isPaintable: paintable })).toEqual(DEFAULT_SHARE_PALETTE);
  });

  it('takes the theme tokens it can paint', () => {
    const vars: Record<string, string> = {
      '--bg-primary': ' #fafafa ',
      '--text-main': '#111111',
      '--text-muted': '#555555',
      '--accent': 'rgb(10, 120, 200)',
      '--bg-card': 'color-mix(in srgb, red 50%, blue)',
      '--border-color': 'rgba(0, 0, 0, 0.1)',
    };
    const palette = resolveSharePalette({ get: name => vars[name] ?? '', isPaintable: paintable });
    expect(palette.bg).toBe('#fafafa');
    expect(palette.text).toBe('#111111');
    expect(palette.muted).toBe('#555555');
    expect(palette.accent).toBe('rgb(10, 120, 200)');
    expect(palette.surface).toBe(DEFAULT_SHARE_PALETTE.surface);
    // --border-medium unset: the next token in the list is used.
    expect(palette.border).toBe('rgba(0, 0, 0, 0.1)');
  });

  it('never uses a see-through background', () => {
    const vars: Record<string, string> = { '--bg-primary': 'rgba(10, 10, 20, 0.4)', '--bg-base': '#101018' };
    expect(resolveSharePalette({ get: name => vars[name] ?? '', isPaintable: paintable }).bg).toBe('#101018');
    const none: Record<string, string> = { '--bg-primary': 'transparent' };
    expect(resolveSharePalette({ get: name => none[name] ?? '', isPaintable: () => true }).bg).toBe(DEFAULT_SHARE_PALETTE.bg);
  });

  it('drops a muted tone that disappears on the background', () => {
    const vars: Record<string, string> = { '--bg-primary': '#07070e', '--text-muted': '#15151f' };
    expect(resolveSharePalette({ get: name => vars[name] ?? '', isPaintable: paintable }).muted).toBe(DEFAULT_SHARE_PALETTE.muted);
  });
});

describe('share colours', () => {
  it('reads alpha from hex and functional notations', () => {
    expect(colorAlpha('#000')).toBe(1);
    expect(colorAlpha('#00000080')).toBeCloseTo(0.5, 1);
    expect(colorAlpha('rgba(0,0,0,0.25)')).toBe(0.25);
    expect(colorAlpha('rgb(0 0 0 / 40%)')).toBe(0.4);
  });

  it('picks readable label text', () => {
    expect(contrastTextColor('#ffff7f')).toBe('#111111');
    expect(contrastTextColor('#1f2937')).toBe('#ffffff');
    expect(contrastTextColor('not-a-colour')).toBe('#ffffff');
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
  });
});

describe('share file names', () => {
  it('slugs titles with accents and symbols', () => {
    expect(slugifyFileName('  Mis JRPG favoritos: ¡Edición 2026!  ')).toBe('mis-jrpg-favoritos-edicion-2026');
    expect(slugifyFileName('Pokémon / Zelda')).toBe('pokemon-zelda');
    expect(slugifyFileName('日本語')).toBe('');
    expect(slugifyFileName('a'.repeat(100)).length).toBe(60);
  });

  it('builds the default names', () => {
    expect(tierListImageFileName('Best Anime of 2025')).toBe('metadea-tierlist-best-anime-of-2025.png');
    expect(tierListImageFileName('???')).toBe('metadea-tierlist.png');
    expect(bingoImageFileName(2026)).toBe('metadea-bingo-2026.png');
  });
});

describe('share image loading', () => {
  it('classifies sources', () => {
    expect(classifyImageSource('https://s4.anilist.co/cover.jpg')).toBe('remote');
    expect(classifyImageSource('//images.igdb.com/x.jpg')).toBe('remote');
    expect(classifyImageSource('data:image/png;base64,AAA')).toBe('inline');
    expect(classifyImageSource('asset://localhost/C%3A/x.png')).toBe('asset');
    expect(classifyImageSource('http://asset.localhost/C%3A/x.png')).toBe('asset');
    expect(classifyImageSource('C:\\Users\\me\\cover.png')).toBe('local');
    expect(classifyImageSource('/home/me/cover.png')).toBe('local');
  });

  it('caches per loader', async () => {
    const load = vi.fn(async () => null);
    const loader = createShareImageLoader(load);
    await Promise.all([loader('a'), loader('a'), loader('b')]);
    expect(load).toHaveBeenCalledTimes(2);
    await createShareImageLoader(load)('a');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('limits concurrency and keeps order', async () => {
    let active = 0;
    let peak = 0;
    const results = await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 6, async i => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active--;
      return i * 2;
    });
    expect(peak).toBe(6);
    expect(results).toEqual(Array.from({ length: 20 }, (_, i) => i * 2));
  });

  it('collects unique image sources', () => {
    const box = { x: 0, y: 0, width: 1, height: 1 };
    const layout: ShareLayout = {
      width: 1, height: 1, scale: 1, grid: { columns: 1, rows: 1 }, showsLines: false,
      elements: [
        { kind: 'image', box, src: 'a', fallbackText: '', shape: 'rect' },
        { kind: 'image', box, src: null, fallbackText: '', shape: 'rect' },
        { kind: 'image', box, src: 'a', fallbackText: '', shape: 'rect' },
        { kind: 'image', box, src: 'b', fallbackText: '', shape: 'circle' },
      ],
    };
    expect(layoutImageSources(layout)).toEqual(['a', 'b']);
  });
});

describe('wrapText', () => {
  const measure = (s: string) => s.length * 10;

  it('wraps words and ellipsizes the last allowed line', () => {
    expect(wrapText('one two three', 80, 3, measure)).toEqual(['one two', 'three']);
    expect(wrapText('one two three four', 80, 1, measure)).toEqual(['one two…']);
    expect(wrapText('one two three four', 60, 1, measure)).toEqual(['one…']);
    expect(wrapText('one two three four five', 80, 2, measure)).toEqual(['one two', 'three…']);
  });

  it('cuts a single word wider than the box', () => {
    expect(wrapText('Supercalifragilistic', 50, 2, measure)).toEqual(['Supe…']);
    expect(wrapText('   ', 50, 2, measure)).toEqual([]);
  });
});
