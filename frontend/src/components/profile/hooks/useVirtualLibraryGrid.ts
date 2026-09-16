import { useLayoutEffect, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';

// Mirrors .library-grid's own two responsive modes in profile.css — unlike
// Local's fixed 120px cards (see useVirtualCardGrid.ts), a card here actually
// changes shape at this breakpoint (stretchy min-300px horizontal card with
// title/rating/date text above it, vs. a fixed 5-column cover-only poster
// grid below it), not just its column count, so this hook has to pick the
// same formula CSS would at the current width instead of having just one.
const NARROW_BREAKPOINT = 1080;
const WIDE_MIN_CARD_WIDTH = 300;
const WIDE_GAP = 13.6; // 0.85rem
const NARROW_COLUMNS = 5;
const NARROW_GAP = 9.6; // 0.6rem

// cardHeight below is computed straight from the same CSS formula as the
// live layout (clamp()/aspect-ratio), not guessed — the `measureElement`
// option below hands the virtualizer this same number back instead of
// actually reading it off the DOM.
interface GridLayout { columns: number; cardWidth: number; cardHeight: number; gap: number }

function computeLayout(containerWidth: number): GridLayout {
  if (containerWidth === 0) return { columns: 1, cardWidth: 0, cardHeight: 120, gap: WIDE_GAP };
  if (window.innerWidth <= NARROW_BREAKPOINT) {
    const cardWidth = (containerWidth - (NARROW_COLUMNS - 1) * NARROW_GAP) / NARROW_COLUMNS;
    // aspect-ratio: 2 / 3, height: auto
    return { columns: NARROW_COLUMNS, cardWidth, cardHeight: cardWidth * 1.5, gap: NARROW_GAP };
  }
  const columns = Math.max(1, Math.floor((containerWidth + WIDE_GAP) / (WIDE_MIN_CARD_WIDTH + WIDE_GAP)));
  const cardWidth = (containerWidth - (columns - 1) * WIDE_GAP) / columns;
  // height: clamp(80px, 15vw, 120px) — vw is the viewport, not this container.
  const cardHeight = Math.min(120, Math.max(80, window.innerWidth * 0.15));
  return { columns, cardWidth, cardHeight, gap: WIDE_GAP };
}

// Same "one window scroll, several independent grids" approach as Local's
// useVirtualCardGrid — each library section (Viendo/Completado/Planeando/...)
// gets its own instance, anchored to the page scroll via scrollMargin.
//
// `enabled` is VirtualLibraryGrid's own "too small to bother" decision,
// passed straight through to useWindowVirtualizer — a disabled virtualizer
// never attaches its scroll/resize listeners at all (see virtual-core's
// `_willUpdate`), so the profile page's half-dozen status sections aren't
// half a dozen live scroll listeners doing range math on every frame just to
// sit there rendering the same handful of cards. This hook still runs
// unconditionally either way (React's rules of hooks) — only the underlying
// work is skipped.
export function useVirtualLibraryGrid(itemCount: number, enabled: boolean, getItemKey: (index: number) => string) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<GridLayout>({ columns: 1, cardWidth: 0, cardHeight: 120, gap: WIDE_GAP });
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      setLayout(computeLayout(el.clientWidth));
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    // A window resize always reflows into a width (or vw-driven height)
    // change here, so the ResizeObserver alone is enough without also
    // listening for 'resize' directly.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled]);

  const virtualizer = useWindowVirtualizer({
    count: itemCount,
    // A card's IDENTITY, not its position, must key its virtual item — see
    // useVirtualCardGrid's own copy of this same reasoning (LibraryCard has
    // its own per-card hover/flyout state that must reset on a genuinely
    // different entry, not survive across one at the same index).
    getItemKey,
    estimateSize: () => layout.cardHeight + layout.gap,
    measureElement: () => layout.cardHeight + layout.gap,
    lanes: layout.columns,
    overscan: layout.columns * 2,
    scrollMargin,
    enabled,
    // See useVirtualCardGrid's own comment — writes each row's position
    // straight to the DOM instead of React reconciling it on every scroll
    // frame for every visible card.
    directDomUpdates: true,
    // 'position' (top), not the default 'transform' — this grid's flyout
    // hover effect (see VirtualLibraryGrid's own comment) needs its z-index
    // to escape to real siblings, which `transform`'s stacking context would
    // trap it inside of.
    directDomUpdatesMode: 'position',
  });

  return { containerRef, layout, virtualizer };
}
