import { useLayoutEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

// Must match .local-games-grid's own `grid-template-columns: repeat(auto-fill,
// 120px)` / `gap: 1rem` in local.css — this hook recreates that layout by
// hand (fixed-width lanes) instead of leaving it to CSS grid, since the
// virtualizer needs to know exactly how many columns fit to figure out which
// rows are actually on/near screen.
export const CARD_WIDTH = 120;
export const CARD_GAP = 16;
// Every card in this grid is the exact same height — a 2:3 cover at a fixed
// 120px width, a fixed inner gap, and a name clamped to exactly 2 lines (see
// .local-game-card/.local-game-cover/.local-game-name in local.css) — so
// this is computed once from those same numbers instead of actually
// measuring the DOM per row (see the `measureElement` option below).
const COVER_HEIGHT = CARD_WIDTH * (3 / 2);
const CARD_INNER_GAP = 8; // .local-game-card's own `gap: 0.5rem`
const TITLE_HEIGHT = 0.72 * 16 * 1.35 * 2; // font-size(rem) * root-px * line-height * 2 lines
const ROW_HEIGHT = COVER_HEIGHT + CARD_INNER_GAP + TITLE_HEIGHT + CARD_GAP;

interface LocalGridScrollAnchor {
  card: HTMLElement;
  top: number;
  virtualized: boolean;
}

let pendingScrollAnchor: LocalGridScrollAnchor | null = null;

export function captureLocalGridScrollAnchor(key: string | null): LocalGridScrollAnchor | null {
  pendingScrollAnchor = null;
  if (!key) return null;

  const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-local-selection-key]'))
    .filter(card => card.dataset.localSelectionKey === key);
  const visible = cards.filter(card => {
    const rect = card.getBoundingClientRect();
    return rect.bottom >= 0 && rect.top <= window.innerHeight;
  });
  const card = (visible.length > 0 ? visible : cards)[0] ?? null;
  if (!card) return null;

  const anchor = {
    card,
    top: card.getBoundingClientRect().top,
    virtualized: !!card.closest('.local-games-grid--virtual'),
  };
  if (anchor.virtualized) pendingScrollAnchor = anchor;
  return anchor;
}

function getPendingScrollAnchor(): LocalGridScrollAnchor | null {
  return pendingScrollAnchor;
}

export function clearLocalGridScrollAnchor(): void {
  pendingScrollAnchor = null;
}

// The window itself scrolls in Local (there's no separate scrolling
// container per grid section), and a single page can have several of these
// grids stacked (one per status/launcher section) — useWindowVirtualizer
// with a per-instance `scrollMargin` (this grid's own offset from the top of
// the document) is what lets each section's virtualizer figure out which of
// ITS OWN rows are on screen against one shared window scroll position,
// instead of every section needing its own scrollable box.
//
// `enabled` is VirtualCardGrid's own "too small to bother" decision, passed
// straight through to useWindowVirtualizer — a disabled virtualizer never
// attaches its scroll/resize listeners at all (see virtual-core's
// `_willUpdate`), so a page with a dozen small sections isn't a dozen live
// scroll listeners doing range math on every frame just to sit there
// rendering the same handful of cards. This hook still runs unconditionally
// either way (React's rules of hooks) — only the underlying work is skipped.
export function useVirtualCardGrid(itemCount: number, enabled: boolean, getItemKey: (index: number) => string | number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(1);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      setColumns(Math.max(1, Math.floor((width + CARD_GAP) / (CARD_WIDTH + CARD_GAP))));
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    // Covers both this grid's own width changing (detail panel opening/
    // closing narrows .local-main-content) and its vertical offset shifting
    // (an earlier section on the page growing/shrinking a row) — a window
    // resize always reflows into one of those anyway, so this alone is
    // enough without also listening for 'resize' directly.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  const virtualizer = useWindowVirtualizer({
    count: itemCount,
    // A card's IDENTITY, not its position, must key its virtual item — an
    // index-based key (the default) would let two DIFFERENT entries that
    // land on the same index across a re-sort/re-filter be treated as "the
    // same" row, keeping stale per-card state (LocalMediaCard's own loaded
    // cover, notably) instead of remounting fresh for the entry actually
    // there now.
    getItemKey,
    estimateSize: () => ROW_HEIGHT,
    // Every card is fixed-size (see ROW_HEIGHT above), so this skips actually
    // reading the DOM box back — it's only here so directDomUpdates below
    // has an elementsCache entry per row to write positions into directly.
    measureElement: () => ROW_HEIGHT,
    lanes: columns,
    overscan: columns * 2,
    scrollMargin,
    enabled,
    // The default (React re-renders every visible row's position on every
    // scroll event) is what was actually causing the scroll lag — 50-ish
    // on-screen cards getting their inline transform reconciled by React 60
    // times a second. This writes each row's transform straight to its DOM
    // node instead, and only triggers a real React render when the set of
    // mounted rows itself changes (something scrolled into/out of range).
    directDomUpdates: true,
  });

  useLayoutEffect(() => {
    const anchor = getPendingScrollAnchor();
    if (!enabled || !anchor || !containerRef.current?.contains(anchor.card)) return;

    const delta = anchor.card.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 0.5) {
      virtualizer.scrollToOffset(window.scrollY + delta, { behavior: 'auto' });
    }
    clearLocalGridScrollAnchor();
  }, [columns, scrollMargin, enabled, virtualizer]);

  return { containerRef, columns, virtualizer };
}
