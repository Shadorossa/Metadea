// Types shared by the share-image pipeline: what a caller hands in (the
// tier list / bingo data plus the owner block), the positioned boxes the
// pure layout step produces, and what the drawing step needs on top
// (palette, fonts, loaded images). Leaf module: imports nothing.

// ── Input ────────────────────────────────────────────────────────────────────

export interface ShareOwner {
  displayName: string;
  /** https/data/asset URL or a local path; null draws the initial. */
  avatarUrl: string | null;
}

export interface TierShareItem {
  title: string;
  coverUrl: string | null;
  externalId: string;
}

export interface TierShareTier {
  label: string;
  /** Any CSS colour the label cell is filled with. */
  color: string;
  /** Label text colour; picked by contrast with `color` when omitted.
   *  The editor passes the one its rows use, so the image matches. */
  textColor?: string;
  items: TierShareItem[];
}

export interface TierListShareData {
  title: string;
  /** Shown under the header, muted, up to two lines; omitted when blank. */
  description?: string;
  tiers: TierShareTier[];
  /** Items left in the pool; shown as a footnote when > 0. */
  unplacedCount?: number;
}

export interface BingoShareCell {
  title: string;
  coverUrl: string | null;
  mediaType: string;
}

export interface BingoShareResult {
  /** One flag per cell, same order as `cells`. */
  completed: boolean[];
  /** Per cell, already formatted in the user's rating system. */
  scores: (string | null)[];
  /** 0–100. */
  percent: number;
  /** Completed lines; computed from `completed` when omitted. Only shown
   *  for perfect-square boards. */
  lines?: number;
}

export interface BingoShareData {
  year: number;
  /** 1–49 cells. */
  size: number;
  cells: (BingoShareCell | null)[];
  /** Absent = "picks" variant (the board before the year is played). */
  result?: BingoShareResult;
}

export type ShareImageInput =
  | { kind: 'tierList'; owner: ShareOwner; data: TierListShareData }
  | { kind: 'bingo'; owner: ShareOwner; data: BingoShareData };

/** Translated templates the layout interpolates (`{n}`, `{year}`, …). */
export interface ShareImageStrings {
  /** "{n} not ranked" */
  tierUnplaced: string;
  /** "Bingo {year}" */
  bingoTitle: string;
  /** "{percent}% complete" */
  bingoPercent: string;
  bingoLinesOne: string;
  /** "{n} lines" */
  bingoLinesOther: string;
  /** "{count} of {size} picked" */
  bingoPicks: string;
}

// ── Layout ───────────────────────────────────────────────────────────────────

export interface ShareBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PaletteRole = 'bg' | 'surface' | 'surfaceAlt' | 'text' | 'muted' | 'accent' | 'onAccent' | 'border';

/** A theme role, resolved at draw time, or a literal CSS colour. */
export type SharePaint = { role: PaletteRole } | { color: string };

export type ShareFontRole = 'display' | 'body';

export interface ShareRectElement {
  kind: 'rect';
  box: ShareBox;
  fill?: SharePaint;
  stroke?: SharePaint;
  strokeWidth?: number;
  radius?: number;
  alpha?: number;
  tag?: string;
}

export interface ShareImageElement {
  kind: 'image';
  box: ShareBox;
  /** null = draw the placeholder straight away. */
  src: string | null;
  /** Placeholder text when the image is missing or fails. */
  fallbackText: string;
  shape: 'rect' | 'circle';
  radius?: number;
  tag?: string;
}

export interface ShareTextElement {
  kind: 'text';
  box: ShareBox;
  text: string;
  size: number;
  weight: number;
  font: ShareFontRole;
  color: SharePaint;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  maxLines: number;
  tag?: string;
}

export interface ShareCheckElement {
  kind: 'check';
  box: ShareBox;
  fill: SharePaint;
  mark: SharePaint;
  tag?: string;
}

export interface ShareLogoElement {
  kind: 'logo';
  box: ShareBox;
  tag?: string;
}

export type ShareElement =
  | ShareRectElement
  | ShareImageElement
  | ShareTextElement
  | ShareCheckElement
  | ShareLogoElement;

export interface ShareLayout {
  /** Logical size; the canvas is `width * scale` × `height * scale`. */
  width: number;
  height: number;
  scale: number;
  /** Painted in order, back to front. */
  elements: ShareElement[];
  /** Grid facts, for callers and tests. */
  grid: { columns: number; rows: number };
  /** Bingo only: whether the header shows the lines count. */
  showsLines: boolean;
}

export interface ShareLayoutOptions {
  owner: ShareOwner;
  strings: ShareImageStrings;
  /** Logical width (default 1600 tier list / 1400 bingo). */
  width?: number;
  /** Device-pixel multiplier (default 2). */
  scale?: number;
  /** Cap on the real (scaled) height; the scale drops to fit (default 8000). */
  maxHeightPx?: number;
}

// ── Drawing ──────────────────────────────────────────────────────────────────

export type SharePalette = Record<PaletteRole, string>;

export interface ShareFonts {
  display: string;
  body: string;
}

export interface ShareImageAssets {
  palette: SharePalette;
  fonts: ShareFonts;
  /** Keyed by the element's `src`; null/missing = placeholder. */
  images: ReadonlyMap<string, CanvasImageSource | null>;
  logo: CanvasImageSource | null;
}
