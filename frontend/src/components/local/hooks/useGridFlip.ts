import { useLayoutEffect, useRef, type RefObject } from 'react';

// FLIP (First-Last-Invert-Play) reflow animation for a grid whose column
// count changes whenever a sibling (the detail panel) resizes the available
// width. CSS Grid item repositioning isn't itself animatable — a card just
// snaps straight to its new cell the instant the browser recomputes layout,
// however smoothly the container's own width transitions — so every card
// visibly "teleported" to its new position on open/close instead of moving
// there. This measures each card's position before and after every commit
// and, whenever one moved, plays that move as a transform animation instead
// of letting it happen as an instant jump.
//
// Runs after every render (no dependency array) rather than being tied to
// a specific "panel open/closed" trigger — a card's position can also shift
// from filtering, sorting, or new items loading in, and all of those
// deserve the same smoothing, not just the panel-resize case this was
// written for.
export function useGridFlip(containerRef: RefObject<HTMLElement | null>, itemSelector: string): void {
  const prevRects = useRef<Map<Element, DOMRect>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));

    for (const el of items) {
      const before = prevRects.current.get(el);
      if (!before) continue;
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) continue;

      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // Forces the browser to apply the transform above before the
      // transition below is turned back on — without this, both style
      // writes get coalesced into a single style recalculation and the
      // "before" position (the whole point of the invert step) never
      // actually renders at all.
      void el.offsetWidth;
      el.style.transition = 'transform 0.3s var(--anim-ease)';
      el.style.transform = '';
      // Restores the card's real transition (its own :hover scale) once
      // this one's done, instead of leaving a 0.3s duration set inline
      // indefinitely.
      window.setTimeout(() => { el.style.transition = ''; }, 300);
    }

    prevRects.current = new Map(items.map(el => [el, el.getBoundingClientRect()]));
  });
}
