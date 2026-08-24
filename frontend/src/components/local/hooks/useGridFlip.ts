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
// One measure-invert-play pass: nudges every item that moved back to its
// last known position via `transform`, then releases it into a real
// transition so it eases into wherever it actually ended up.
function flip(items: HTMLElement[], prevRects: Map<Element, DOMRect>): void {
  for (const el of items) {
    const before = prevRects.get(el);
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

export function useGridFlip(containerRef: RefObject<HTMLElement | null>, itemSelector: string, panelOpen = false): void {
  const prevRects = useRef<Map<Element, DOMRect>>(new Map());
  const prevPanelOpenRef = useRef(panelOpen);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
    const suppress = panelOpen && prevPanelOpenRef.current;
    prevPanelOpenRef.current = panelOpen;

    if (!suppress) flip(items, prevRects.current);
    prevRects.current = new Map(items.map(el => [el, el.getBoundingClientRect()]));

    // The panel's own open/close animates via `transform` (no layout impact
    // on its own), but its sibling (.local-main-content) claims/releases
    // that width through an actual `transition: width` so the grid visually
    // keeps pace with the slide instead of snapping the instant the panel
    // mounts/unmounts (see that rule's own comment). That means the resize
    // this hook exists to smooth doesn't happen in the one render captured
    // above — it happens continuously, frame by frame, over the following
    // ~300ms of that CSS transition, entirely outside of React. Querying
    // geometry synchronously right after the class/DOM change above only
    // ever sees the pre-transition value (the transition's own clock hasn't
    // ticked yet), so without this, every one of those native reflow frames
    // would go through completely unsmoothed — cards visibly snapping
    // between grid columns as the available width crosses each threshold.
    // Re-running the same invert-play correction on every resize tick keeps
    // covering for it until the ancestor's own transition settles.
    const ro = new ResizeObserver(() => {
      const current = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
      flip(current, prevRects.current);
      prevRects.current = new Map(current.map(el => [el, el.getBoundingClientRect()]));
    });
    ro.observe(container);
    return () => ro.disconnect();
  });
}
