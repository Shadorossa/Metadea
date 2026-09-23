import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { EpubChapterContent } from '../../../lib/tauri/epub-reader';
import { wrapAssetUrl } from '../../../lib/tauri/bridge';
import type { ReaderPreferences } from '../../../lib/reader/reader-preferences';
import { buildChapterFragment, buildReaderStyles, fragmentOffset, rewriteCssAssets } from '../../../lib/reader/epub-chapter-dom';
import {
  computePageCount,
  fractionFromPage,
  fractionFromScroll,
  pageFromFraction,
  pageOffset,
  scrollFromFraction,
} from '../../../lib/reader/epub-pagination';
import type { ChapterTarget } from './useEpubBook';

// Renders a chapter inside a shadow root on the host element and drives
// the two reading modes: paginated (CSS multi-column, one column per
// screen, scrollLeft snapped to a column) and scroll (plain vertical
// scrolling). The shadow root keeps the book's CSS from leaking into the
// app and the app's from restyling the book; chapter links never navigate
// (the click handler routes them through the callbacks).

const COLUMN_GAP = 48;
const WHEEL_COOLDOWN_MS = 220;

interface ShadowParts {
  root: ShadowRoot;
  style: HTMLStyleElement;
  publisher: HTMLStyleElement;
  viewport: HTMLDivElement;
  chapter: HTMLDivElement;
}

export interface EpubLayoutOptions {
  hostRef: RefObject<HTMLDivElement | null>;
  chapter: EpubChapterContent | null;
  chapterKey: string;
  target: ChapterTarget;
  prefs: ReaderPreferences;
  onBoundary: (direction: 'prev' | 'next') => void;
  onInternalLink: (href: string) => void;
  onExternalLink: (url: string) => void;
}

export interface EpubLayoutState {
  page: number;
  pageCount: number;
  fraction: number;
}

function clampPage(page: number, pageCount: number): number {
  return Math.min(Math.max(1, pageCount) - 1, Math.max(0, page));
}

export function useEpubLayout(opts: EpubLayoutOptions) {
  const [state, setState] = useState<EpubLayoutState>({ page: 0, pageCount: 1, fraction: 0 });
  const partsRef = useRef<ShadowParts | null>(null);
  const layoutRef = useRef<EpubLayoutState>({ page: 0, pageCount: 1, fraction: 0 });
  const pendingTargetRef = useRef<ChapterTarget | null>(null);
  const optsRef = useRef(opts);
  useLayoutEffect(() => { optsRef.current = opts; });

  // The shadow root is built once per host element.
  useLayoutEffect(() => {
    const host = opts.hostRef.current;
    if (!host || partsRef.current) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
    root.replaceChildren();
    const style = document.createElement('style');
    const publisher = document.createElement('style');
    const viewport = document.createElement('div');
    viewport.className = 'epub-viewport';
    const columns = document.createElement('div');
    columns.className = 'epub-columns';
    const chapter = document.createElement('div');
    chapter.className = 'epub-chapter';
    columns.append(chapter);
    viewport.append(columns);
    root.append(style, publisher, viewport);
    partsRef.current = { root, style, publisher, viewport, chapter };
  }, [opts.hostRef]);

  const commit = useCallback((next: EpubLayoutState) => {
    layoutRef.current = next;
    setState(next);
  }, []);

  // Measures the viewport, rewrites the reader stylesheet for that size
  // and places the reader at the pending target (or keeps its fraction).
  const relayout = useCallback(() => {
    const parts = partsRef.current;
    if (!parts) return;
    const { viewport, chapter, style } = parts;
    const { prefs } = optsRef.current;
    const pageWidth = viewport.clientWidth;
    const pageHeight = viewport.clientHeight;
    if (pageWidth === 0 || pageHeight === 0) return;
    const paginated = prefs.flow === 'paginated';
    viewport.classList.toggle('epub-viewport--scroll', !paginated);
    style.textContent = buildReaderStyles(prefs, pageWidth, pageHeight, COLUMN_GAP);

    let fraction = layoutRef.current.fraction;
    let fragment: string | null = null;
    const pending = pendingTargetRef.current;
    if (pending) {
      pendingTargetRef.current = null;
      fraction = pending.fraction ?? 0;
      fragment = pending.fragment ?? null;
    }
    const anchor = fragment ? fragmentOffset(chapter, fragment) : null;

    if (paginated) {
      viewport.scrollTop = 0;
      const pageCount = computePageCount(viewport.scrollWidth, pageWidth, COLUMN_GAP);
      let page = pageFromFraction(fraction, pageCount);
      if (anchor) page = clampPage(Math.floor(anchor.left / (pageWidth + COLUMN_GAP)), pageCount);
      viewport.scrollLeft = pageOffset(page, pageWidth, COLUMN_GAP);
      commit({ page, pageCount, fraction: fractionFromPage(page, pageCount) });
    } else {
      viewport.scrollLeft = 0;
      viewport.scrollTop = anchor ? anchor.top : scrollFromFraction(fraction, viewport.scrollHeight, viewport.clientHeight);
      commit({ page: 0, pageCount: 1, fraction: fractionFromScroll(viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight) });
    }
  }, [commit]);

  // New chapter content: swap the DOM and land on its target.
  useEffect(() => {
    const parts = partsRef.current;
    if (!parts) return;
    parts.chapter.replaceChildren();
    if (!opts.chapter) return;
    pendingTargetRef.current = opts.target;
    parts.chapter.append(buildChapterFragment(opts.chapter.html, wrapAssetUrl));
    const raf = requestAnimationFrame(relayout);
    return () => cancelAnimationFrame(raf);
  }, [opts.chapter, opts.chapterKey, opts.target, relayout]);

  // Preferences (and the publisher CSS toggle) restyle without losing the place.
  useEffect(() => {
    const parts = partsRef.current;
    if (!parts) return;
    const css = opts.prefs.publisherStyles && opts.chapter ? opts.chapter.css.map(c => rewriteCssAssets(c, wrapAssetUrl)).join('\n') : '';
    parts.publisher.textContent = css;
    const raf = requestAnimationFrame(relayout);
    return () => cancelAnimationFrame(raf);
  }, [opts.prefs, opts.chapter, relayout]);

  // Anything that changes the chapter's extent (window size, images and
  // fonts arriving) re-measures the page count around the same fraction.
  useEffect(() => {
    const parts = partsRef.current;
    const host = opts.hostRef.current;
    if (!parts || !host) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(relayout);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(host);
    parts.chapter.addEventListener('load', schedule, true);
    document.fonts?.ready.then(schedule).catch(() => {});
    return () => {
      observer.disconnect();
      parts.chapter.removeEventListener('load', schedule, true);
      cancelAnimationFrame(raf);
    };
  }, [opts.hostRef, relayout]);

  const goToPage = useCallback((page: number) => {
    const parts = partsRef.current;
    if (!parts) return;
    const { pageCount } = layoutRef.current;
    const clamped = clampPage(page, pageCount);
    parts.viewport.scrollLeft = pageOffset(clamped, parts.viewport.clientWidth, COLUMN_GAP);
    commit({ page: clamped, pageCount, fraction: fractionFromPage(clamped, pageCount) });
  }, [commit]);

  const scrollScreens = useCallback((screens: number) => {
    const parts = partsRef.current;
    if (!parts) return;
    parts.viewport.scrollBy({ top: parts.viewport.clientHeight * 0.9 * screens, behavior: 'smooth' });
  }, []);

  const next = useCallback(() => {
    const parts = partsRef.current;
    if (!parts) return;
    if (optsRef.current.prefs.flow === 'paginated') {
      const { page, pageCount } = layoutRef.current;
      if (page < pageCount - 1) goToPage(page + 1);
      else optsRef.current.onBoundary('next');
      return;
    }
    const v = parts.viewport;
    if (v.scrollTop + v.clientHeight >= v.scrollHeight - 2) optsRef.current.onBoundary('next');
    else scrollScreens(1);
  }, [goToPage, scrollScreens]);

  const prev = useCallback(() => {
    const parts = partsRef.current;
    if (!parts) return;
    if (optsRef.current.prefs.flow === 'paginated') {
      const { page } = layoutRef.current;
      if (page > 0) goToPage(page - 1);
      else optsRef.current.onBoundary('prev');
      return;
    }
    if (parts.viewport.scrollTop <= 1) optsRef.current.onBoundary('prev');
    else scrollScreens(-1);
  }, [goToPage, scrollScreens]);

  const goToFraction = useCallback((fraction: number) => {
    const parts = partsRef.current;
    if (!parts) return;
    if (optsRef.current.prefs.flow === 'paginated') {
      goToPage(pageFromFraction(fraction, layoutRef.current.pageCount));
      return;
    }
    const v = parts.viewport;
    v.scrollTop = scrollFromFraction(fraction, v.scrollHeight, v.clientHeight);
  }, [goToPage]);

  const goToFragment = useCallback((fragment: string) => {
    pendingTargetRef.current = { fragment, fraction: layoutRef.current.fraction };
    relayout();
  }, [relayout]);

  // Scroll mode reports its fraction from the scroll position; paginated
  // mode turns pages on the wheel.
  useEffect(() => {
    const parts = partsRef.current;
    if (!parts) return;
    const { viewport } = parts;
    let raf = 0;
    let lastWheel = 0;
    const onScroll = () => {
      if (optsRef.current.prefs.flow !== 'scroll') return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const { pageCount } = layoutRef.current;
        commit({ page: 0, pageCount, fraction: fractionFromScroll(viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight) });
      });
    };
    const onWheel = (e: WheelEvent) => {
      if (optsRef.current.prefs.flow !== 'paginated') return;
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheel < WHEEL_COOLDOWN_MS || Math.abs(e.deltaY) < 4) return;
      lastWheel = now;
      if (e.deltaY > 0) next();
      else prev();
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      viewport.removeEventListener('wheel', onWheel);
      cancelAnimationFrame(raf);
    };
  }, [commit, next, prev]);

  // Links go through the callbacks; a plain click on the side thirds of a
  // paginated view turns the page (unless the reader is selecting text).
  useEffect(() => {
    const parts = partsRef.current;
    if (!parts) return;
    const onClick = (e: Event) => {
      const anchor = e.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
      if (anchor) {
        e.preventDefault();
        const internal = anchor.getAttribute('data-epub-href');
        const external = anchor.getAttribute('data-external-href');
        if (internal) optsRef.current.onInternalLink(internal);
        else if (external) optsRef.current.onExternalLink(external);
        return;
      }
      if (optsRef.current.prefs.flow !== 'paginated') return;
      if (window.getSelection()?.toString()) return;
      const me = e as MouseEvent;
      const rect = parts.viewport.getBoundingClientRect();
      const x = (me.clientX - rect.left) / rect.width;
      if (x < 0.3) prev();
      else if (x > 0.7) next();
    };
    parts.root.addEventListener('click', onClick);
    return () => parts.root.removeEventListener('click', onClick);
  }, [next, prev]);

  const goStart = useCallback(() => goToFraction(0), [goToFraction]);
  const goEnd = useCallback(() => goToFraction(1), [goToFraction]);

  return { state, next, prev, goStart, goEnd, goToFraction, goToFragment };
}
