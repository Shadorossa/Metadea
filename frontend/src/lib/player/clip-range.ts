// Clip selection on the seek bar (scissors button): a start/end pair kept
// 3–10 s long and inside the file. Mirrors src-tauri/src/player/clip/plan.rs
// (`clamp_range`), which re-checks whatever the controls send. Pure.

export const MIN_CLIP_SECS = 3;
export const MAX_CLIP_SECS = 10;
export const DEFAULT_CLIP_SECS = 5;

export interface ClipRange {
  start: number;
  end: number;
}

function fileLength(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
}

/** Keeps `start` where possible; the length is clamped to 3–10 s. */
export function clampClipRange(start: number, end: number, duration: number): ClipRange {
  const total = fileLength(duration);
  const from = Number.isFinite(start) ? Math.max(0, start) : 0;
  const requested = Number.isFinite(end) ? end - from : MIN_CLIP_SECS;
  const length = Math.min(Math.min(MAX_CLIP_SECS, Math.max(MIN_CLIP_SECS, requested)), total);
  const clampedStart = Math.min(from, Math.max(0, total - length));
  return { start: clampedStart, end: clampedStart + length };
}

/** Entering clip mode: current time → +5 s. */
export function initialClipRange(position: number, duration: number): ClipRange {
  return clampClipRange(position, position + DEFAULT_CLIP_SECS, duration);
}

/** Moves the start handle; the end follows only as far as the 3–10 s rule needs. */
export function moveClipStart(range: ClipRange, start: number, duration: number): ClipRange {
  const total = fileLength(duration);
  const from = Math.min(Math.max(0, start), Math.max(0, total - MIN_CLIP_SECS));
  const length = Math.min(MAX_CLIP_SECS, Math.max(MIN_CLIP_SECS, range.end - from));
  return clampClipRange(from, from + length, duration);
}

/** Moves the end handle; the start follows only as far as the 3–10 s rule needs. */
export function moveClipEnd(range: ClipRange, end: number, duration: number): ClipRange {
  const total = fileLength(duration);
  const to = Math.min(total, Math.max(Math.min(MIN_CLIP_SECS, total), end));
  const length = Math.min(MAX_CLIP_SECS, Math.max(MIN_CLIP_SECS, to - range.start));
  return { start: Math.max(0, to - length), end: to };
}

export function clipLength(range: ClipRange): number {
  return Math.max(0, range.end - range.start);
}
