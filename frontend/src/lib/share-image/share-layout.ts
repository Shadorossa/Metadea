// Pure geometry of the share images: data in, positioned boxes out. Nothing
// here touches a canvas or the DOM, so wrapping, grid and scale math are
// unit-tested directly (share-draw.ts only paints what this returns).
//
// Everything is in logical pixels; the canvas is `width * scale` wide. The
// tier list keeps TierMaker's look (a coloured label cell per tier, covers
// wrapping at 2:3), the bingo is a centred grid whose last row is centred.
import type {
  BingoShareData,
  ShareBox,
  ShareElement,
  ShareLayout,
  ShareLayoutOptions,
  ShareOwner,
  TierListShareData,
} from './share-image-types';
import { contrastTextColor } from './share-color';

export const SHARE_SITE_URL = 'metadea.pages.dev';
export const SHARE_WORDMARK = 'Metadea';

export const TIER_IMAGE_WIDTH = 1600;
export const BINGO_IMAGE_WIDTH = 1400;
export const DEFAULT_SHARE_SCALE = 2;
export const MAX_SHARE_HEIGHT_PX = 8000;
export const BINGO_MAX_CELLS = 49;

const PAD = 56;
const HEADER_H = 88;
const SECTION_GAP = 36;
const FOOTER_H = 60;
const STATS_W = 380;

const TIER_LABEL_W = 168;
const TIER_SEPARATOR = 3;
const TIER_INNER = 8;
const TIER_TILE_GAP = 6;
const TIER_NOMINAL_TILE_W = 112;
const NOTE_H = 32;
const DESCRIPTION_SIZE = 22;
const DESCRIPTION_MAX_LINES = 2;

const BINGO_GAP = 14;
const BINGO_MAX_CELL_W = 300;
const COVER_RATIO = 1.5;

export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** Largest scale ≤ `preferred` that keeps `height * scale` within `maxHeightPx`. */
export function capScale(height: number, preferred: number, maxHeightPx: number): number {
  if (height <= 0 || height * preferred <= maxHeightPx) return preferred;
  return Math.floor((maxHeightPx / height) * 1000) / 1000;
}

export function isPerfectSquare(n: number): boolean {
  if (!Number.isInteger(n) || n < 1) return false;
  const root = Math.round(Math.sqrt(n));
  return root * root === n;
}

export function clampBingoSize(size: number): number {
  if (!Number.isFinite(size)) return 1;
  return Math.max(1, Math.min(BINGO_MAX_CELLS, Math.floor(size)));
}

/** Columns and rows of a bingo board: ceil(sqrt(size)) columns. */
export function bingoGrid(size: number): { columns: number; rows: number; lastRowCount: number } {
  const n = clampBingoSize(size);
  const columns = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / columns);
  return { columns, rows, lastRowCount: n - (rows - 1) * columns };
}

/** Full rows, columns and both diagonals of a perfect-square board. */
export function countBingoLines(completed: readonly boolean[], size: number): number {
  if (!isPerfectSquare(size)) return 0;
  const n = Math.round(Math.sqrt(size));
  const done = (row: number, col: number) => completed[row * n + col] === true;
  if (n === 1) return done(0, 0) ? 1 : 0;
  const range = Array.from({ length: n }, (_, i) => i);
  let lines = 0;
  for (const r of range) if (range.every(c => done(r, c))) lines++;
  for (const c of range) if (range.every(r => done(r, c))) lines++;
  if (range.every(i => done(i, i))) lines++;
  if (range.every(i => done(i, n - 1 - i))) lines++;
  return lines;
}

// ── Shared blocks ────────────────────────────────────────────────────────────

function headerElements(owner: ShareOwner, title: string, width: number, reserveRight: number): ShareElement[] {
  const avatar: ShareBox = { x: PAD, y: PAD, width: HEADER_H, height: HEADER_H };
  const textX = PAD + HEADER_H + 24;
  const textW = Math.max(120, width - PAD - reserveRight - textX);
  const name = owner.displayName.trim();
  return [
    { kind: 'image', box: avatar, src: owner.avatarUrl || null, fallbackText: (name[0] ?? 'M').toUpperCase(), shape: 'circle', tag: 'avatar' },
    { kind: 'rect', box: { x: avatar.x - 3, y: avatar.y - 3, width: HEADER_H + 6, height: HEADER_H + 6 }, stroke: { role: 'accent' }, strokeWidth: 3, radius: (HEADER_H + 6) / 2, tag: 'avatar-ring' },
    { kind: 'text', box: { x: textX, y: PAD - 2, width: textW, height: 54 }, text: title, size: 44, weight: 700, font: 'display', color: { role: 'text' }, align: 'left', valign: 'middle', maxLines: 1, tag: 'title' },
    { kind: 'text', box: { x: textX, y: PAD + 54, width: textW, height: 32 }, text: name, size: 24, weight: 500, font: 'body', color: { role: 'muted' }, align: 'left', valign: 'middle', maxLines: 1, tag: 'owner-name' },
  ];
}

function headerDivider(width: number): ShareElement {
  return { kind: 'rect', box: { x: PAD, y: PAD + HEADER_H + SECTION_GAP / 2, width: width - PAD * 2, height: 2 }, fill: { role: 'border' }, tag: 'divider' };
}

function footerElements(width: number, top: number): ShareElement[] {
  const rowY = top + 18;
  const logo = 38;
  return [
    { kind: 'rect', box: { x: PAD, y: top, width: width - PAD * 2, height: 2 }, fill: { role: 'border' }, tag: 'divider' },
    { kind: 'logo', box: { x: PAD, y: rowY, width: logo, height: logo }, tag: 'logo' },
    { kind: 'text', box: { x: PAD + logo + 14, y: rowY, width: 300, height: logo }, text: SHARE_WORDMARK, size: 26, weight: 700, font: 'display', color: { role: 'text' }, align: 'left', valign: 'middle', maxLines: 1, tag: 'wordmark' },
    { kind: 'text', box: { x: width - PAD - 500, y: rowY, width: 500, height: logo }, text: SHARE_SITE_URL, size: 22, weight: 500, font: 'body', color: { role: 'muted' }, align: 'right', valign: 'middle', maxLines: 1, tag: 'site-url' },
  ];
}

function finish(width: number, contentBottom: number, elements: ShareElement[], opts: ShareLayoutOptions, grid: ShareLayout['grid'], showsLines: boolean): ShareLayout {
  const footerTop = contentBottom + SECTION_GAP;
  const height = Math.ceil(footerTop + FOOTER_H + PAD);
  const scale = capScale(height, opts.scale ?? DEFAULT_SHARE_SCALE, opts.maxHeightPx ?? MAX_SHARE_HEIGHT_PX);
  const background: ShareElement = { kind: 'rect', box: { x: 0, y: 0, width, height }, fill: { role: 'bg' }, tag: 'background' };
  return { width, height, scale, elements: [background, ...elements, ...footerElements(width, footerTop)], grid, showsLines };
}

// ── Tier list ────────────────────────────────────────────────────────────────

/** Columns and tile size of the tier board's cover area. */
export function tierTileGrid(areaWidth: number): { columns: number; tileWidth: number; tileHeight: number } {
  const usable = areaWidth - TIER_INNER * 2;
  const columns = Math.max(1, Math.floor((usable + TIER_TILE_GAP) / (TIER_NOMINAL_TILE_W + TIER_TILE_GAP)));
  const tileWidth = (usable - (columns - 1) * TIER_TILE_GAP) / columns;
  return { columns, tileWidth, tileHeight: tileWidth * COVER_RATIO };
}

export function layoutTierListImage(data: TierListShareData, opts: ShareLayoutOptions): ShareLayout {
  const width = opts.width ?? TIER_IMAGE_WIDTH;
  const elements: ShareElement[] = [...headerElements(opts.owner, data.title, width, 0), headerDivider(width)];

  const boardX = PAD;
  const boardW = width - PAD * 2;
  let boardTop = PAD + HEADER_H + SECTION_GAP;
  const description = data.description?.trim() ?? '';
  if (description) {
    // Height reserved for the most lines it may wrap to; the text sits at
    // the top of its box, so a one-liner just leaves a little air.
    const descriptionH = Math.ceil(DESCRIPTION_SIZE * 1.2 * DESCRIPTION_MAX_LINES);
    elements.push({ kind: 'text', box: { x: boardX, y: boardTop, width: boardW, height: descriptionH }, text: description, size: DESCRIPTION_SIZE, weight: 400, font: 'body', color: { role: 'muted' }, align: 'left', valign: 'top', maxLines: DESCRIPTION_MAX_LINES, tag: 'description' });
    boardTop += descriptionH + 24;
  }
  const { columns, tileWidth, tileHeight } = tierTileGrid(boardW - TIER_LABEL_W);
  const areaX = boardX + TIER_LABEL_W + TIER_INNER;

  const bands: ShareElement[] = [];
  let y = boardTop;
  let totalRows = 0;
  data.tiers.forEach((tier, index) => {
    if (index > 0) y += TIER_SEPARATOR;
    const lines = Math.max(1, Math.ceil(tier.items.length / columns));
    totalRows += lines;
    const bandH = TIER_INNER * 2 + lines * tileHeight + (lines - 1) * TIER_TILE_GAP;
    bands.push({ kind: 'rect', box: { x: boardX, y, width: boardW, height: bandH }, fill: { role: 'surfaceAlt' }, tag: 'tier-band' });
    const label: ShareBox = { x: boardX, y, width: TIER_LABEL_W, height: bandH };
    bands.push({ kind: 'rect', box: label, fill: { color: tier.color }, tag: 'tier-label' });
    const fontSize = tier.label.trim().length <= 3 ? 44 : 24;
    bands.push({
      kind: 'text',
      box: { x: label.x + 10, y: label.y + 6, width: label.width - 20, height: label.height - 12 },
      text: tier.label,
      size: fontSize,
      weight: 700,
      font: 'body',
      color: { color: tier.textColor || contrastTextColor(tier.color) },
      align: 'center',
      valign: 'middle',
      maxLines: Math.max(1, Math.floor((label.height - 12) / (fontSize * 1.2))),
      tag: 'tier-label-text',
    });
    tier.items.forEach((item, i) => {
      bands.push({
        kind: 'image',
        box: {
          x: areaX + (i % columns) * (tileWidth + TIER_TILE_GAP),
          y: y + TIER_INNER + Math.floor(i / columns) * (tileHeight + TIER_TILE_GAP),
          width: tileWidth,
          height: tileHeight,
        },
        src: item.coverUrl || null,
        fallbackText: item.title,
        shape: 'rect',
        radius: 4,
        tag: 'tier-tile',
      });
    });
    y += bandH;
  });

  if (data.tiers.length > 0) {
    // The frame behind the bands: shows through the separators.
    elements.push({ kind: 'rect', box: { x: boardX - TIER_SEPARATOR, y: boardTop - TIER_SEPARATOR, width: boardW + TIER_SEPARATOR * 2, height: y - boardTop + TIER_SEPARATOR * 2 }, fill: { role: 'border' }, tag: 'tier-frame' });
    y += TIER_SEPARATOR;
  }
  elements.push(...bands);

  const unplaced = data.unplacedCount ?? 0;
  if (unplaced > 0) {
    y += 16;
    elements.push({ kind: 'text', box: { x: boardX, y, width: boardW, height: NOTE_H }, text: interpolate(opts.strings.tierUnplaced, { n: unplaced }), size: 20, weight: 500, font: 'body', color: { role: 'muted' }, align: 'left', valign: 'middle', maxLines: 1, tag: 'unplaced-note' });
    y += NOTE_H;
  }

  return finish(width, y, elements, opts, { columns, rows: totalRows }, false);
}

// ── Bingo ────────────────────────────────────────────────────────────────────

export function layoutBingoImage(data: BingoShareData, opts: ShareLayoutOptions): ShareLayout {
  const width = opts.width ?? BINGO_IMAGE_WIDTH;
  const size = clampBingoSize(data.size);
  const { strings } = opts;
  const result = data.result;
  const showsLines = !!result && isPerfectSquare(size);

  const title = interpolate(strings.bingoTitle, { year: data.year });
  const elements: ShareElement[] = [...headerElements(opts.owner, title, width, STATS_W), headerDivider(width)];

  const statsX = width - PAD - STATS_W;
  const headline = result
    ? interpolate(strings.bingoPercent, { percent: Math.round(result.percent) })
    : interpolate(strings.bingoPicks, { count: data.cells.slice(0, size).filter(Boolean).length, size });
  elements.push({ kind: 'text', box: { x: statsX, y: PAD - 2, width: STATS_W, height: 54 }, text: headline, size: result ? 40 : 28, weight: 800, font: 'body', color: { role: 'accent' }, align: 'right', valign: 'middle', maxLines: 1, tag: 'bingo-headline' });
  if (result && showsLines) {
    const lines = result.lines ?? countBingoLines(result.completed, size);
    const template = lines === 1 ? strings.bingoLinesOne : strings.bingoLinesOther;
    elements.push({ kind: 'text', box: { x: statsX, y: PAD + 54, width: STATS_W, height: 32 }, text: interpolate(template, { n: lines }), size: 24, weight: 600, font: 'body', color: { role: 'text' }, align: 'right', valign: 'middle', maxLines: 1, tag: 'bingo-lines' });
  }

  const { columns, rows, lastRowCount } = bingoGrid(size);
  const gridW = width - PAD * 2;
  const cellW = Math.min(BINGO_MAX_CELL_W, (gridW - (columns - 1) * BINGO_GAP) / columns);
  const cellH = cellW * COVER_RATIO;
  const usedW = columns * cellW + (columns - 1) * BINGO_GAP;
  const gridX = PAD + (gridW - usedW) / 2;
  const gridTop = PAD + HEADER_H + SECTION_GAP + 12;
  const radius = Math.max(6, cellW * 0.05);

  for (let i = 0; i < size; i++) {
    const row = Math.floor(i / columns);
    const col = i % columns;
    const rowOffset = row === rows - 1 ? ((columns - lastRowCount) * (cellW + BINGO_GAP)) / 2 : 0;
    const box: ShareBox = { x: gridX + rowOffset + col * (cellW + BINGO_GAP), y: gridTop + row * (cellH + BINGO_GAP), width: cellW, height: cellH };
    const cell = data.cells[i] ?? null;

    if (!cell) {
      elements.push({ kind: 'rect', box, fill: { role: 'surface' }, stroke: { role: 'border' }, strokeWidth: 2, radius, tag: 'bingo-cell-empty' });
      elements.push({ kind: 'text', box, text: String(i + 1), size: Math.round(cellW * 0.22), weight: 700, font: 'display', color: { role: 'muted' }, align: 'center', valign: 'middle', maxLines: 1, tag: 'bingo-cell-number' });
      continue;
    }
    elements.push({ kind: 'image', box, src: cell.coverUrl || null, fallbackText: cell.title, shape: 'rect', radius, tag: 'bingo-cell' });
    if (!result) continue;

    if (!result.completed[i]) {
      elements.push({ kind: 'rect', box, fill: { color: '#000000' }, alpha: 0.55, radius, tag: 'bingo-dim' });
      continue;
    }
    const ring = 5;
    elements.push({ kind: 'rect', box: { x: box.x - ring, y: box.y - ring, width: box.width + ring * 2, height: box.height + ring * 2 }, stroke: { role: 'accent' }, strokeWidth: 5, radius: radius + ring, tag: 'bingo-ring' });
    const check = Math.max(26, Math.round(cellW * 0.2));
    elements.push({ kind: 'check', box: { x: box.x + box.width - check - 8, y: box.y + 8, width: check, height: check }, fill: { role: 'accent' }, mark: { role: 'onAccent' }, tag: 'bingo-check' });
    const score = result.scores[i];
    if (score) {
      const fontSize = Math.max(16, Math.round(cellW * 0.1));
      const badgeH = Math.round(fontSize * 1.7);
      const badgeW = Math.min(box.width - 16, fontSize * 0.62 * score.length + badgeH);
      const badge: ShareBox = { x: box.x + (box.width - badgeW) / 2, y: box.y + box.height - badgeH - 10, width: badgeW, height: badgeH };
      elements.push({ kind: 'rect', box: badge, fill: { role: 'accent' }, radius: badgeH / 2, tag: 'bingo-score' });
      elements.push({ kind: 'text', box: badge, text: score, size: fontSize, weight: 800, font: 'body', color: { role: 'onAccent' }, align: 'center', valign: 'middle', maxLines: 1, tag: 'bingo-score-text' });
    }
  }

  const gridBottom = gridTop + rows * cellH + (rows - 1) * BINGO_GAP;
  return finish(width, gridBottom, elements, opts, { columns, rows }, showsLines);
}
