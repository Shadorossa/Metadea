// Seek-bar hover preview math (components/player/PlayerSeekPreview). Pure:
// no React, no Tauri. Mirrors src-tauri/src/player/thumbnails/plan.rs —
// frame `i` covers [i·interval, (i+1)·interval) and sprite sheets hold
// `columns × rows` tiles filled row by row.

import type { PlayerChapter } from './player-status';

/** Displayed width of the preview frame, in CSS px (tiles are 240 px). */
export const PREVIEW_WIDTH_PX = 200;
/** Gap kept between the preview and the player's left/right edges. */
export const PREVIEW_EDGE_MARGIN_PX = 8;
/** Hover must rest this long before an on-demand frame is requested. */
export const EXACT_REQUEST_DEBOUNCE_MS = 120;

export interface ThumbnailGrid {
  intervalSecs: number;
  count: number;
  tileWidth: number;
  tileHeight: number;
}

/** The slot a hover time falls into, clamped to the grid. */
export function frameIndexFor(secs: number, intervalSecs: number, count: number): number {
  if (count <= 0 || !(intervalSecs > 0) || !Number.isFinite(secs)) return 0;
  return Math.min(count - 1, Math.max(0, Math.floor(secs / intervalSecs)));
}

/**
 * The closest frame that exists, searching outward from `target` (ties go
 * to the earlier frame), within `maxDistance` slots; null if none.
 */
export function nearestAvailableFrame(
  target: number,
  has: (index: number) => boolean,
  count: number,
  maxDistance = count,
): number | null {
  if (count <= 0) return null;
  const start = Math.min(count - 1, Math.max(0, target));
  for (let distance = 0; distance <= maxDistance; distance += 1) {
    const before = start - distance;
    const after = start + distance;
    if (before < 0 && after >= count) break;
    if (before >= 0 && has(before)) return before;
    if (after < count && has(after)) return after;
  }
  return null;
}

/**
 * Whether a frame `distance` slots away is still a fair stand-in: the
 * slot itself or a direct neighbour. Farther than that, the preview asks
 * for an exact frame at the hover time.
 */
export function isCloseEnough(frameIndex: number | null, target: number): boolean {
  return frameIndex !== null && Math.abs(frameIndex - target) <= 1;
}

export interface SpriteTile {
  sheet: number;
  column: number;
  row: number;
}

export function spriteTile(index: number, columns: number, rows: number): SpriteTile {
  const perSheet = Math.max(1, columns * rows);
  const within = index % perSheet;
  return { sheet: Math.floor(index / perSheet), column: within % columns, row: Math.floor(within / columns) };
}

/** CSS for showing one tile of a sheet at `displayWidth` px wide. */
export function spriteStyle(tile: SpriteTile, columns: number, displayWidth: number, displayHeight: number) {
  return {
    backgroundSize: `${columns * displayWidth}px auto`,
    backgroundPosition: `${-tile.column * displayWidth}px ${-tile.row * displayHeight}px`,
  };
}

/** Preview height for a tile aspect, 16:9 until the first tile is known. */
export function previewHeight(grid: Pick<ThumbnailGrid, 'tileWidth' | 'tileHeight'> | null, width = PREVIEW_WIDTH_PX): number {
  if (!grid || grid.tileWidth <= 0 || grid.tileHeight <= 0) return Math.round((width * 9) / 16);
  return Math.round((width * grid.tileHeight) / grid.tileWidth);
}

/**
 * Left offset (relative to the seek bar) that centres a `width`-wide
 * preview on the pointer while keeping it inside the player: `boundsLeft`
 * and `boundsRight` are the player's edges and `barLeft` the bar's left
 * edge, all in the same (viewport) coordinates.
 */
export function clampPreviewLeft(
  pointerX: number,
  width: number,
  barLeft: number,
  boundsLeft: number,
  boundsRight: number,
  margin = PREVIEW_EDGE_MARGIN_PX,
): number {
  const min = boundsLeft + margin;
  const max = boundsRight - margin - width;
  const centred = pointerX - width / 2;
  const clamped = max < min ? (boundsLeft + boundsRight - width) / 2 : Math.min(max, Math.max(min, centred));
  return clamped - barLeft;
}

/** The chapter playing at `secs` (the last one starting at or before it). */
export function chapterAt(chapters: readonly PlayerChapter[], secs: number): PlayerChapter | null {
  let found: PlayerChapter | null = null;
  for (const chapter of chapters) {
    if (chapter.time_secs <= secs + 1e-6 && (!found || chapter.time_secs >= found.time_secs)) found = chapter;
  }
  return found;
}

/** Key an on-demand frame is cached under: the hover time to 0.5 s. */
export function exactFrameKey(secs: number): number {
  return Math.round(secs * 2) / 2;
}
