import { describe, expect, it } from 'vitest';
import {
  bingoGrid,
  capScale,
  countBingoLines,
  interpolate,
  isPerfectSquare,
  layoutBingoImage,
  layoutTierListImage,
  tierTileGrid,
  MAX_SHARE_HEIGHT_PX,
} from './share-layout';
import type { BingoShareData, ShareElement, ShareImageElement, ShareLayout, ShareLayoutOptions, TierListShareData } from './share-image-types';

const opts: ShareLayoutOptions = {
  owner: { displayName: 'Nacho', avatarUrl: 'https://example.com/a.png' },
  strings: {
    tierUnplaced: '{n} not ranked',
    bingoTitle: 'Bingo {year}',
    bingoPercent: '{percent}% complete',
    bingoLinesOne: '{n} line',
    bingoLinesOther: '{n} lines',
    bingoPicks: '{count} of {size} picked',
  },
};

const TIER_COLORS = ['#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f'];

const byTag = (layout: ShareLayout, tag: string): ShareElement[] => layout.elements.filter(el => el.tag === tag);
const textOf = (layout: ShareLayout, tag: string) => {
  const el = byTag(layout, tag)[0];
  return el?.kind === 'text' ? el.text : undefined;
};
const cellsOf = (layout: ShareLayout) => layout.elements.filter(el => el.tag === 'bingo-cell' || el.tag === 'bingo-cell-empty');

function tierData(counts: number[], unplacedCount?: number): TierListShareData {
  return {
    title: 'Best JRPGs',
    unplacedCount,
    tiers: counts.map((count, t) => ({
      label: 'SABCDEF'[t] ?? 'Z',
      color: TIER_COLORS[t % TIER_COLORS.length],
      items: Array.from({ length: count }, (_, i) => ({ title: `Game ${t}-${i}`, coverUrl: `https://img/${t}/${i}.jpg`, externalId: `igdb:${t}${i}` })),
    })),
  };
}

function bingoData(size: number, withResult = true): BingoShareData {
  const cells = Array.from({ length: size }, (_, i) => (i % 4 === 3 ? null : { title: `Work ${i}`, coverUrl: `https://img/${i}.jpg`, mediaType: 'anime' }));
  return {
    year: 2026,
    size,
    cells,
    result: withResult
      ? { completed: cells.map((c, i) => !!c && i % 2 === 0), scores: cells.map((c, i) => (c && i % 2 === 0 ? '8.5' : null)), percent: 42.4 }
      : undefined,
  };
}

describe('tier list layout', () => {
  it('is 1600 wide at scale 2 and starts with the background', () => {
    const layout = layoutTierListImage(tierData([3, 2]), opts);
    expect(layout.width).toBe(1600);
    expect(layout.scale).toBe(2);
    expect(layout.elements[0]).toMatchObject({ kind: 'rect', tag: 'background', box: { x: 0, y: 0, width: 1600, height: layout.height } });
  });

  it('wraps covers into rows at a 2:3 ratio', () => {
    const { columns, tileWidth, tileHeight } = tierTileGrid(1600 - 112 - 168);
    expect(columns).toBe(11);
    expect(tileHeight / tileWidth).toBeCloseTo(1.5);

    const layout = layoutTierListImage(tierData([columns + 1, 0, 2 * columns]), opts);
    const tiles = byTag(layout, 'tier-tile') as ShareImageElement[];
    expect(tiles).toHaveLength(3 * columns + 1);
    for (const tile of tiles) {
      expect(tile.box.width).toBeCloseTo(tileWidth);
      expect(tile.box.height).toBeCloseTo(tileHeight);
      expect(tile.box.x + tile.box.width).toBeLessThanOrEqual(1600 - 56 + 0.001);
    }
    // Tier S: cover columns+1 wraps to a second line under the first.
    expect(tiles[columns].box.x).toBeCloseTo(tiles[0].box.x);
    expect(tiles[columns].box.y).toBeGreaterThan(tiles[0].box.y + tiles[0].box.height);
    // Bands: 2 lines, 1 (an empty tier keeps one line), 2 lines.
    const heights = byTag(layout, 'tier-band').map(b => b.box.height);
    expect(heights[0]).toBeCloseTo(heights[2]);
    expect(heights[0] - heights[1]).toBeCloseTo(tileHeight + 6);
    expect(layout.grid).toEqual({ columns, rows: 5 });
  });

  it('stacks tiers without overlap, labels filled with the tier colour', () => {
    const layout = layoutTierListImage(tierData([4, 30, 1]), opts);
    const bands = byTag(layout, 'tier-band');
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].box.y).toBeGreaterThanOrEqual(bands[i - 1].box.y + bands[i - 1].box.height);
    }
    expect(byTag(layout, 'tier-label')[0]).toMatchObject({ fill: { color: '#ff7f7f' } });
    const labelText = byTag(layout, 'tier-label-text')[0];
    expect(labelText.kind === 'text' && labelText.color).toEqual({ color: '#111111' });
  });

  it('adds the header, owner, footer and the unplaced note', () => {
    const layout = layoutTierListImage(tierData([1], 7), opts);
    expect(textOf(layout, 'title')).toBe('Best JRPGs');
    expect(textOf(layout, 'owner-name')).toBe('Nacho');
    expect(textOf(layout, 'unplaced-note')).toBe('7 not ranked');
    expect(textOf(layout, 'site-url')).toBe('metadea.pages.dev');
    expect(byTag(layout, 'logo')).toHaveLength(1);
    expect(byTag(layout, 'avatar')[0]).toMatchObject({ kind: 'image', shape: 'circle', src: 'https://example.com/a.png', fallbackText: 'N' });
    expect(byTag(layoutTierListImage(tierData([1], 0), opts), 'unplaced-note')).toHaveLength(0);
  });

  it('grows with content and lowers the scale past the 8000 px cap', () => {
    const small = layoutTierListImage(tierData([5]), opts);
    const big = layoutTierListImage(tierData([400, 400, 400]), opts);
    expect(big.height).toBeGreaterThan(small.height);
    expect(small.scale).toBe(2);
    expect(big.scale).toBeLessThan(2);
    expect(Math.round(big.height * big.scale)).toBeLessThanOrEqual(MAX_SHARE_HEIGHT_PX);
    expect(big.height * big.scale).toBeGreaterThan(MAX_SHARE_HEIGHT_PX - 20);
  });

  it('handles a board with no tiers', () => {
    const layout = layoutTierListImage({ title: 'Empty', tiers: [] }, opts);
    expect(byTag(layout, 'tier-band')).toHaveLength(0);
    expect(byTag(layout, 'tier-frame')).toHaveLength(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('adds the description under the header and pushes the board down', () => {
    const plain = layoutTierListImage(tierData([2]), opts);
    const withText = layoutTierListImage({ ...tierData([2]), description: '  My ranking of the decade  ' }, opts);
    expect(byTag(plain, 'description')).toHaveLength(0);
    expect(byTag(layoutTierListImage({ ...tierData([2]), description: '   ' }, opts), 'description')).toHaveLength(0);
    const description = byTag(withText, 'description')[0];
    expect(description).toMatchObject({ kind: 'text', text: 'My ranking of the decade', maxLines: 2, color: { role: 'muted' } });
    const band = byTag(withText, 'tier-band')[0];
    expect(band.box.y).toBeGreaterThanOrEqual(description.box.y + description.box.height);
    expect(band.box.y).toBeGreaterThan(byTag(plain, 'tier-band')[0].box.y);
    expect(withText.height - plain.height).toBeCloseTo(band.box.y - byTag(plain, 'tier-band')[0].box.y);
  });

  it('uses the tier text colour when given, contrast otherwise', () => {
    const data = tierData([1, 1]);
    data.tiers[0].textColor = '#f7f7f7';
    const labels = byTag(layoutTierListImage(data, opts), 'tier-label-text');
    expect(labels[0].kind === 'text' && labels[0].color).toEqual({ color: '#f7f7f7' });
    expect(labels[1].kind === 'text' && labels[1].color).toEqual({ color: '#111111' });
  });
});

describe('capScale', () => {
  it('keeps the preferred scale when it fits', () => {
    expect(capScale(1000, 2, 8000)).toBe(2);
    expect(capScale(4000, 2, 8000)).toBe(2);
  });

  it('drops the scale to fit the cap', () => {
    expect(capScale(5000, 2, 8000)).toBe(1.6);
    expect(capScale(10001, 2, 8000) * 10001).toBeLessThanOrEqual(8000);
  });
});

describe('bingo layout', () => {
  it.each([
    [1, 1, 1, 1],
    [5, 3, 2, 2],
    [10, 4, 3, 2],
    [16, 4, 4, 4],
    [49, 7, 7, 7],
  ])('size %i: %i columns x %i rows, %i in the last row', (size, columns, rows, last) => {
    expect(bingoGrid(size)).toEqual({ columns, rows, lastRowCount: last });
    const layout = layoutBingoImage(bingoData(size), opts);
    expect(layout.grid).toEqual({ columns, rows });
    const cells = cellsOf(layout);
    expect(cells).toHaveLength(size);
    for (const cell of cells) {
      expect(cell.box.height / cell.box.width).toBeCloseTo(1.5);
      expect(cell.box.x).toBeGreaterThanOrEqual(0);
      expect(cell.box.x + cell.box.width).toBeLessThanOrEqual(layout.width);
    }
    expect(layout.height * layout.scale).toBeLessThanOrEqual(MAX_SHARE_HEIGHT_PX);
  });

  it('centres the last row', () => {
    const layout = layoutBingoImage(bingoData(10), opts);
    const cells = cellsOf(layout);
    const centre = (row: ShareElement[]) => (row[0].box.x + row[row.length - 1].box.x + row[0].box.width) / 2;
    expect(centre(cells.slice(0, 4))).toBeCloseTo(layout.width / 2);
    expect(centre(cells.slice(8))).toBeCloseTo(layout.width / 2);
  });

  it('rings, checks and scores completed cells and dims the rest', () => {
    const data = bingoData(16);
    const layout = layoutBingoImage(data, opts);
    const completed = data.result?.completed.filter(Boolean).length ?? 0;
    const picked = data.cells.filter(Boolean).length;
    expect(completed).toBeGreaterThan(0);
    expect(byTag(layout, 'bingo-ring')).toHaveLength(completed);
    expect(byTag(layout, 'bingo-check')).toHaveLength(completed);
    expect(byTag(layout, 'bingo-score-text')).toHaveLength(completed);
    expect(byTag(layout, 'bingo-dim')).toHaveLength(picked - completed);
    expect(byTag(layout, 'bingo-cell-empty')).toHaveLength(16 - picked);
    expect(textOf(layout, 'bingo-score-text')).toBe('8.5');
    expect(textOf(layout, 'title')).toBe('Bingo 2026');
    expect(textOf(layout, 'bingo-headline')).toBe('42% complete');
  });

  it('shows lines only for perfect-square boards', () => {
    const square = layoutBingoImage(bingoData(16), opts);
    expect(square.showsLines).toBe(true);
    expect(byTag(square, 'bingo-lines')).toHaveLength(1);
    const odd = layoutBingoImage(bingoData(10), opts);
    expect(odd.showsLines).toBe(false);
    expect(byTag(odd, 'bingo-lines')).toHaveLength(0);
  });

  it('uses the given line count, or counts it, with singular/plural', () => {
    const data = bingoData(9);
    data.result = { completed: [true, true, true, false, false, false, false, false, false], scores: [], percent: 33 };
    expect(textOf(layoutBingoImage(data, opts), 'bingo-lines')).toBe('1 line');
    data.result.lines = 4;
    expect(textOf(layoutBingoImage(data, opts), 'bingo-lines')).toBe('4 lines');
  });

  it('switches to the picks variant without a result', () => {
    const layout = layoutBingoImage(bingoData(16, false), opts);
    expect(layout.showsLines).toBe(false);
    expect(textOf(layout, 'bingo-headline')).toBe('12 of 16 picked');
    expect(byTag(layout, 'bingo-ring')).toHaveLength(0);
    expect(byTag(layout, 'bingo-dim')).toHaveLength(0);
  });

  it('clamps out-of-range sizes', () => {
    expect(layoutBingoImage({ year: 2026, size: 80, cells: [] }, opts).grid).toEqual({ columns: 7, rows: 7 });
    expect(layoutBingoImage({ year: 2026, size: 0, cells: [] }, opts).grid).toEqual({ columns: 1, rows: 1 });
  });
});

describe('bingo helpers', () => {
  it('detects perfect squares', () => {
    expect([1, 4, 9, 16, 25, 36, 49].every(isPerfectSquare)).toBe(true);
    expect([0, 2, 5, 10, 48, 1.5].some(isPerfectSquare)).toBe(false);
  });

  it('counts rows, columns and diagonals', () => {
    expect(countBingoLines(Array(16).fill(true), 16)).toBe(10);
    expect(countBingoLines(Array.from({ length: 9 }, (_, i) => i % 4 === 0), 9)).toBe(1);
    expect(countBingoLines([true], 1)).toBe(1);
    expect(countBingoLines(Array(10).fill(true), 10)).toBe(0);
  });

  it('interpolates known placeholders only', () => {
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });
});
