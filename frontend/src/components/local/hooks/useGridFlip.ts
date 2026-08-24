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
//
// `panelOpen` (pass whether the detail panel is currently open) suppresses
// actually animating whenever it's true on BOTH this render and the
// previous one — i.e. the panel was already open and stays open. A
// background refetch (episode marked watched, playtime synced, ...)
// re-rendering the grid while the panel just sits open can shift a card by
// a stray sub-pixel or two for reasons that have nothing to do with the
// panel itself (a badge's text changing width slightly, say), which doesn't
// deserve a repositioning animation replaying while the user is just
// sitting there reading it. The render where the panel actually opens or
// closes — panelOpen flipping from the previous render's value — still
// animates: that's the real grid resize this hook exists for in the first
// place. Positions are still tracked underneath either way, so the first
// reflow after a suppressed stretch measures from an accurate "before"
// instead of animating a big stale jump once it resumes.
export function useGridFlip(containerRef: RefObject<HTMLElement | null>, itemSelector: string, panelOpen = false): void {
  const prevRects = useRef<Map<Element, DOMRect>>(new Map());
  const prevPanelOpenRef = useRef(panelOpen);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
    const suppress = panelOpen && prevPanelOpenRef.current;
    prevPanelOpenRef.current = panelOpen;

    if (!suppress) {
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
    }

    prevRects.current = new Map(items.map(el => [el, el.getBoundingClientRect()]));
  });
}
