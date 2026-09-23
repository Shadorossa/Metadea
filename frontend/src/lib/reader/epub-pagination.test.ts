import { describe, it, expect } from 'vitest';
import {
  EPUB_READ_THRESHOLD,
  bookPercent,
  computePageCount,
  formatPercent,
  fractionFromPage,
  fractionFromScroll,
  isBookFinished,
  pageFromFraction,
  pageOffset,
  resolveSpineTarget,
  resumePositionFrom,
  scrollFromFraction,
  tocIndexForChapter,
} from './epub-pagination';

describe('page count and offsets', () => {
  it('counts one column per screen width plus gap', () => {
    // 3 columns of 800 with 40 gaps: 800*3 + 40*2 = 2480 of scroll width.
    expect(computePageCount(2480, 800, 40)).toBe(3);
    expect(computePageCount(800, 800, 40)).toBe(1);
    expect(computePageCount(0, 800, 40)).toBe(1);
    expect(computePageCount(2480, 0, 0)).toBe(1);
  });

  it('offsets a page by column plus gap', () => {
    expect(pageOffset(0, 800, 40)).toBe(0);
    expect(pageOffset(2, 800, 40)).toBe(1680);
    expect(pageOffset(-1, 800, 40)).toBe(0);
  });
});

describe('fraction <-> page', () => {
  it('maps the first and last page to 0 and 1', () => {
    expect(fractionFromPage(0, 5)).toBe(0);
    expect(fractionFromPage(4, 5)).toBe(1);
    expect(fractionFromPage(2, 5)).toBe(0.5);
    expect(fractionFromPage(0, 1)).toBe(0);
  });

  it('round-trips through pageFromFraction and clamps', () => {
    for (let page = 0; page < 7; page++) {
      expect(pageFromFraction(fractionFromPage(page, 7), 7)).toBe(page);
    }
    expect(pageFromFraction(1.7, 4)).toBe(3);
    expect(pageFromFraction(-1, 4)).toBe(0);
    expect(pageFromFraction(0.5, 1)).toBe(0);
    expect(pageFromFraction(Number.NaN, 4)).toBe(0);
  });

  it('keeps a position when the page count changes', () => {
    const fraction = fractionFromPage(3, 7); // page 4 of 7
    expect(pageFromFraction(fraction, 14)).toBe(7);
    expect(pageFromFraction(fraction, 3)).toBe(1);
  });
});

describe('scroll fractions', () => {
  it('maps scrollTop over the scrollable range', () => {
    expect(fractionFromScroll(0, 3000, 600)).toBe(0);
    expect(fractionFromScroll(2400, 3000, 600)).toBe(1);
    expect(fractionFromScroll(1200, 3000, 600)).toBe(0.5);
    expect(fractionFromScroll(10, 500, 600)).toBe(0);
    expect(scrollFromFraction(0.5, 3000, 600)).toBe(1200);
    expect(scrollFromFraction(0.5, 500, 600)).toBe(0);
  });
});

describe('bookPercent', () => {
  const bytes = [1000, 3000, 6000];

  it('weights chapters by byte length', () => {
    expect(bookPercent(bytes, 0, 0)).toBe(0);
    expect(bookPercent(bytes, 1, 0)).toBeCloseTo(0.1);
    expect(bookPercent(bytes, 1, 0.5)).toBeCloseTo(0.25);
    expect(bookPercent(bytes, 2, 1)).toBe(1);
  });

  it('falls back to equal weights when sizes are unknown', () => {
    expect(bookPercent([0, 0, 0, 0], 2, 0.5)).toBeCloseTo(0.625);
    expect(bookPercent([], 0, 1)).toBe(0);
  });

  it('clamps out-of-range chapter indexes and fractions', () => {
    expect(bookPercent(bytes, 9, 2)).toBe(1);
    expect(bookPercent(bytes, -3, -1)).toBe(0);
  });

  it('formats and applies the read threshold', () => {
    expect(formatPercent(0.376)).toBe('38');
    expect(formatPercent(2)).toBe('100');
    expect(isBookFinished(EPUB_READ_THRESHOLD)).toBe(true);
    expect(isBookFinished(0.97)).toBe(false);
  });
});

describe('spine resolution', () => {
  const chapters = [{ href: 'OEBPS/text/ch1.xhtml' }, { href: 'OEBPS/text/ch2.xhtml' }];

  it('finds a chapter by root-relative path and keeps the fragment', () => {
    expect(resolveSpineTarget(chapters, 'OEBPS/text/ch2.xhtml#sec')).toEqual({ index: 1, fragment: 'sec' });
    expect(resolveSpineTarget(chapters, 'OEBPS/text/ch1.xhtml')).toEqual({ index: 0, fragment: null });
    expect(resolveSpineTarget(chapters, 'OEBPS/text/ch1.xhtml#')).toEqual({ index: 0, fragment: null });
  });

  it('returns null for unknown or fragment-only targets', () => {
    expect(resolveSpineTarget(chapters, 'OEBPS/text/missing.xhtml')).toBeNull();
    expect(resolveSpineTarget(chapters, '#top')).toBeNull();
  });

  it('highlights the TOC entry of a chapter', () => {
    const toc = [{ href: 'OEBPS/text/ch1.xhtml' }, { href: 'OEBPS/text/ch1.xhtml#part2' }, { href: 'OEBPS/text/ch2.xhtml' }];
    expect(tocIndexForChapter(toc, 'OEBPS/text/ch2.xhtml')).toBe(2);
    expect(tocIndexForChapter(toc, 'nope')).toBe(-1);
  });
});

describe('resumePositionFrom', () => {
  it('uses the EPUB shape when present', () => {
    expect(resumePositionFrom({ pageNumber: 9, chapterIndex: 4, chapterFraction: 0.4 }, 10)).toEqual({ chapterIndex: 4, fraction: 0.4 });
  });

  it('maps a page-only row to a chapter start and clamps', () => {
    expect(resumePositionFrom({ pageNumber: 3, chapterIndex: null, chapterFraction: null }, 10)).toEqual({ chapterIndex: 2, fraction: 0 });
    expect(resumePositionFrom({ pageNumber: 50, chapterIndex: null, chapterFraction: null }, 10)).toEqual({ chapterIndex: 9, fraction: 0 });
    expect(resumePositionFrom(null, 10)).toEqual({ chapterIndex: 0, fraction: 0 });
    expect(resumePositionFrom({ pageNumber: 1, chapterIndex: 0, chapterFraction: 0 }, 0)).toEqual({ chapterIndex: 0, fraction: 0 });
  });
});
