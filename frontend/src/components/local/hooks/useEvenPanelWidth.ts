import { useLayoutEffect, useState } from 'react';

// Matches .local-game-detail-panel's own CSS clamp (width: 60vw; max-width:
// 860px; min-width: 320px) — the "natural" width the panel would have with
// no correction applied, used below purely as the baseline the leftover
// gets added on top of, and as the return value's fallback before anything
// has actually been measured yet. Simple enough to keep in sync with that
// CSS rule by hand; everything else this hook needs (card width, grid gap,
// main content's padding) is measured live off the real DOM instead of
// also being duplicated here, so it keeps working if any of THOSE ever
// change.
const MIN_PANEL_PX = 320;
const MAX_PANEL_PX = 860;
const IDEAL_PANEL_VW = 0.6;

// Astro/React SSR renders this component (and therefore this hook's
// useState initializer below) on the server first, where `window` doesn't
// exist at all — falls back to the CSS rule's own hard max there, since
// there's no real window width yet to compute a real value against. Every
// actual client-side call (the useLayoutEffect below never runs during
// SSR) gets the real, window-aware result.
function naturalPanelWidth(): number {
  if (typeof window === 'undefined') return MAX_PANEL_PX;
  return Math.min(MAX_PANEL_PX, Math.max(MIN_PANEL_PX, window.innerWidth * IDEAL_PANEL_VW));
}

// .local-games-grid's cards are a fixed size (see that CSS rule's own
// comment) — deliberately, so they never visibly resize when the panel
// opens/closes — which means the row width almost never divides evenly by
// (card + gap), leaving a sliver of empty space at the end of every row
// while the panel is open. This widens the panel by exactly that sliver
// instead — the grid ends up filling its available width exactly, and
// nothing about the cards themselves (their size or the gap between them)
// changes at all.
//
// Recomputed from the actual rendered DOM (not a copy of the CSS's own
// numbers) every time .local-games-container's width changes while the
// panel is open — an OS window resize included, not just a React-driven
// reflow — so it never drifts out of sync with whatever the grid actually
// renders.
//
// Always returns a number (the natural width, unrounded, before anything's
// been measured) rather than undefined — LocalLibrary.tsx applies this SAME
// number to both the panel's own width AND .local-main-content's reserved
// margin, synchronously on the exact render panelOpen flips, in EITHER
// direction. That's what actually keeps the games-grid-area's own resize
// reciprocal between opening and closing: the panel's own slide in/out is
// a separate, purely visual animation (see DetailPanelShell), no longer
// something the grid's own reflow has to wait on to know how much space it
// gets back.
export function useEvenPanelWidth(panelOpen: boolean): number {
  const [width, setWidth] = useState<number>(naturalPanelWidth);

  useLayoutEffect(() => {
    if (!panelOpen) return;

    const container = document.querySelector<HTMLElement>('.local-games-container');
    if (!container) return;

    function recompute() {
      const mainContent = document.querySelector<HTMLElement>('.local-main-content');
      const grid = mainContent?.querySelector<HTMLElement>('.local-games-grid');
      const card = grid?.querySelector<HTMLElement>('.local-game-card');
      const panelNatural = naturalPanelWidth();
      if (!container || !mainContent || !grid || !card) { setWidth(panelNatural); return; }

      const containerWidth = container.getBoundingClientRect().width;
      const mainStyle = getComputedStyle(mainContent);
      const mainPadding = (parseFloat(mainStyle.paddingLeft) || 0) + (parseFloat(mainStyle.paddingRight) || 0);
      const gridAvailable = containerWidth - panelNatural - mainPadding;

      const cardWidth = card.getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(grid).columnGap || '0') || 0;
      const pitch = cardWidth + gap;
      if (pitch <= 0 || gridAvailable <= 0 || cardWidth <= 0) { setWidth(panelNatural); return; }

      const numCols = Math.max(1, Math.floor((gridAvailable + gap) / pitch));
      const idealGridWidth = numCols * pitch - gap;
      const leftover = gridAvailable - idealGridWidth;
      setWidth(panelNatural + leftover);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(container);
    return () => ro.disconnect();
  }, [panelOpen]);

  return width;
}
