// Pure page/position arithmetic for the EPUB reader. Paginated mode lays a
// chapter out in CSS columns, one column per screen; a "page" is a column
// and the chapter's scrollWidth tells how many there are. Positions are
// stored as a 0–1 fraction of the chapter so they survive font/size/window
// changes (which change the page count but not the fraction).

/** Byte-weighted share of the book at which the EPUB counts as read — the
 *  comic reader's "last page reached" equivalent for a format with no
 *  fixed last page. */
export const EPUB_READ_THRESHOLD = 0.98;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Number of columns a chapter occupies: total scroll width divided by
 *  one column + its gap (the last gap is not rendered, hence the rounding). */
export function computePageCount(scrollWidth: number, pageWidth: number, gap: number): number {
  const stride = pageWidth + gap;
  if (!(stride > 0) || !(scrollWidth > 0)) return 1;
  return Math.max(1, Math.round((scrollWidth + gap) / stride));
}

export function pageOffset(page: number, pageWidth: number, gap: number): number {
  return Math.max(0, page) * (pageWidth + gap);
}

export function fractionFromPage(page: number, pageCount: number): number {
  if (pageCount <= 1) return 0;
  return clamp01(page / (pageCount - 1));
}

export function pageFromFraction(fraction: number, pageCount: number): number {
  if (pageCount <= 1) return 0;
  return Math.min(pageCount - 1, Math.max(0, Math.round(clamp01(fraction) * (pageCount - 1))));
}

/** Scroll mode counterpart: how far down a scrollable chapter the reader is. */
export function fractionFromScroll(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const range = scrollHeight - clientHeight;
  if (range <= 0) return 0;
  return clamp01(scrollTop / range);
}

export function scrollFromFraction(fraction: number, scrollHeight: number, clientHeight: number): number {
  return Math.max(0, scrollHeight - clientHeight) * clamp01(fraction);
}

/** Share of the whole book read, weighting chapters by their byte size:
 *  every chapter before the current one counts fully, the current one by
 *  its fraction. A book whose sizes are all 0 falls back to chapter count. */
export function bookPercent(chapterBytes: readonly number[], chapterIndex: number, fraction: number): number {
  const count = chapterBytes.length;
  if (count === 0) return 0;
  const index = Math.min(count - 1, Math.max(0, chapterIndex));
  const total = chapterBytes.reduce((sum, b) => sum + Math.max(0, b), 0);
  const weights = total > 0 ? chapterBytes.map(b => Math.max(0, b) / total) : chapterBytes.map(() => 1 / count);
  let done = 0;
  for (let i = 0; i < index; i++) done += weights[i];
  done += weights[index] * clamp01(fraction);
  return clamp01(done);
}

export function formatPercent(fraction: number): string {
  return String(Math.round(clamp01(fraction) * 100));
}

export function isBookFinished(percent: number): boolean {
  return percent >= EPUB_READ_THRESHOLD;
}

export interface SpineTarget {
  index: number;
  fragment: string | null;
}

/** Maps a root-relative href (from the TOC or an in-book link, fragment
 *  allowed) to the spine chapter that renders it. */
export function resolveSpineTarget(chapters: ReadonlyArray<{ href: string }>, href: string): SpineTarget | null {
  const hash = href.indexOf('#');
  const path = hash === -1 ? href : href.slice(0, hash);
  const fragment = hash === -1 ? null : href.slice(hash + 1) || null;
  if (!path) return null;
  const index = chapters.findIndex(c => c.href === path);
  return index === -1 ? null : { index, fragment };
}

/** Which TOC entry to highlight for a chapter: the last entry whose
 *  target file is that chapter (so nested entries resolve to their own
 *  chapter, not the parent's). */
export function tocIndexForChapter(toc: ReadonlyArray<{ href: string }>, chapterHref: string): number {
  return toc.findIndex(entry => (entry.href.split('#')[0] ?? '') === chapterHref);
}

export interface ResumePosition {
  chapterIndex: number;
  fraction: number;
}

/** Turns a stored reading_progress row (either shape) into a start
 *  position. Comic-shaped rows (page only) map page → chapter. */
export function resumePositionFrom(
  row: { pageNumber: number; chapterIndex: number | null; chapterFraction: number | null } | null,
  chapterCount: number,
): ResumePosition {
  if (!row || chapterCount <= 0) return { chapterIndex: 0, fraction: 0 };
  const index = row.chapterIndex ?? row.pageNumber - 1;
  const clampedIndex = Math.min(chapterCount - 1, Math.max(0, Math.floor(index)));
  return { chapterIndex: clampedIndex, fraction: clamp01(row.chapterFraction ?? 0) };
}
