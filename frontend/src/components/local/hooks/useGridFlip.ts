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
// getBoundingClientRect() is VIEWPORT-relative — fine for a one-off
// measurement, but this hook compares one measurement against a LATER one,
// and the viewport itself moves every time the user scrolls. Any unrelated
// state update elsewhere in LocalLibrary that re-renders during a scroll
// (useActivePlatform's IntersectionObserver flipping the sidebar's active
// icon as a new section crosses into view, for instance) reran this hook's
// per-render effect below mid-scroll, measured every card's now-different
// viewport position, and "flipped" the entire visible grid back and forth
// as if it had all genuinely moved — which is exactly the janky transition
// this was producing while scrolling toward the bottom of a long list.
// Adding the current scroll offset converts the measurement to a
// document-relative position, which pure scrolling — nothing on the page
// actually moved relative to its neighbors — never changes.
function measure(el: HTMLElement): { left: number; top: number } {
  const rect = el.getBoundingClientRect();
  return { left: rect.left + window.scrollX, top: rect.top + window.scrollY };
}

// Pending "restore the card's real transition" timeout per element — a
// second flip() call on the same card (the ResizeObserver below can fire
// many times while the panel's own width transition is still running)
// used to leave the FIRST call's timeout armed too. Whichever one fired
// last just blindly reset `transition` to '', which could land mid-flight
// through a NEWER transform and cut it off — the card visibly snapping/
// jumping instead of easing in, compounding into the "breaks the view"
// jank on every subsequent tick. Clearing the old one before scheduling a
// new one means only the most recent flip's timeout ever actually fires.
const pendingRestore = new WeakMap<HTMLElement, ReturnType<typeof window.setTimeout>>();

// Sub-pixel deltas (fractions of a px from float rounding between a
// getBoundingClientRect() reading and the scrollX/scrollY added to it)
// aren't visible either way, but treating them as "moved" still ran the
// full transition dance below — `transition: none` then back, forcing a
// synchronous layout read (el.offsetWidth) — for every on-screen card on
// every single re-render that happened to land mid-scroll. That's the
// "some cards still move for no reason"/stutter left over after the
// viewport-vs-document fix above: individually invisible, but forcing that
// many synchronous reflows back-to-back is exactly what reads as the grid
// stuttering while scrolling. A real reposition (a column changing) is
// always many whole pixels, so this threshold never masks one.
const FLIP_THRESHOLD_PX = 0.5;

// A width change (panel opening/closing) can reshuffle EVERY card in the
// grid at once — going from N columns to N+2 moves nearly every card to a
// different row. Animating all of that simultaneously, including hundreds
// of cards nowhere near the screen, is what made a close-then-scroll read
// as "cards flying up from below in a broken way": off-screen cards were
// mid-flight (still easing toward their new spot over their own 0.3s) at
// the exact moment the user's scroll brought them into view, so what
// should've been a settled grid was instead caught mid-animation. A card
// that was never visible during the reflow doesn't need to be seen
// smoothly arriving at its new spot — it can just already be there,
// same as if the page had loaded fresh in that scroll position. Generous
// viewport margin so a card just past the fold still gets the smoothing
// once it's actually reachable by scrolling during the transition.
const VIEWPORT_MARGIN_PX = 600;

function isNearViewport(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.bottom > -VIEWPORT_MARGIN_PX && rect.top < window.innerHeight + VIEWPORT_MARGIN_PX;
}

// One measure-invert-play pass: nudges every item that moved back to its
// last known position via `transform`, then releases it into a real
// transition so it eases into wherever it actually ended up.
function flip(items: HTMLElement[], prevRects: Map<Element, { left: number; top: number }>): void {
  for (const el of items) {
    const before = prevRects.get(el);
    if (!before) continue;
    if (!isNearViewport(el)) continue;
    const after = measure(el);
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (Math.abs(dx) < FLIP_THRESHOLD_PX && Math.abs(dy) < FLIP_THRESHOLD_PX) continue;

    const pending = pendingRestore.get(el);
    if (pending) window.clearTimeout(pending);

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
    pendingRestore.set(el, window.setTimeout(() => {
      el.style.transition = '';
      pendingRestore.delete(el);
    }, 300));
  }
}

export function useGridFlip(containerRef: RefObject<HTMLElement | null>, itemSelector: string, panelOpen = false): void {
  const prevRects = useRef<Map<Element, { left: number; top: number }>>(new Map());
  const prevPanelOpenRef = useRef(panelOpen);
  // Armed for a short window right after the panel closes — see below.
  const suppressUntilRef = useRef(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
    const panelJustClosed = prevPanelOpenRef.current && !panelOpen;
    // usePendingLaunchers' own live IGDB lookups can resolve a moment after
    // the panel closes and move a card from "Planeando" into its launcher
    // section — a real, legitimate position change, but one the user never
    // asked for and isn't looking at happen, so animating it right on the
    // heels of the close transition reads as the SAME cards that just
    // settled suddenly jumping and re-settling again — 'ya están colocados
    // donde van' and then an unprompted aggressive flip anyway. This is what
    // made it specifically show up scrolled deep into the list: more
    // sections visible near the viewport means more chances one of them has
    // a pending resolution land in this window. The close transition's OWN
    // flip (panelJustClosed) still always plays — only renders that follow
    // it within the grace window get suppressed; prevRects keeps tracking
    // positions underneath regardless, so once the window lapses the next
    // real comparison is against accurate data, not a stale pre-window one.
    const suppress = (panelOpen && prevPanelOpenRef.current)
      || (!panelJustClosed && Date.now() < suppressUntilRef.current);
    prevPanelOpenRef.current = panelOpen;

    if (!suppress) flip(items, prevRects.current);
    prevRects.current = new Map(items.map(el => [el, measure(el)]));
    if (panelJustClosed) suppressUntilRef.current = Date.now() + 300;

    // .local-main-content's own width change on panel open/close is
    // deliberately INSTANT, not CSS-transitioned (see that rule's own
    // comment) — this hook's flip() above is what plays the 0.3s motion
    // itself, from one synchronous before/after snapshot, so there's no
    // multi-frame native transition left for a ResizeObserver to catch up
    // with mid-flight. What it's still for: a resize this hook's own
    // render-triggered effect never sees at all — the OS window itself
    // being resized, which changes layout without any React render firing.
    //
    // ResizeObserver fires on ANY border-box change, though, not just
    // width — `container` is the WHOLE grid (every platform section), so it
    // also grows taller as the user scrolls and more cards' covers lazy-
    // load in, or as an IntersectionObserver elsewhere flips a section into
    // view. That's an ordinary content-height change with nothing to do
    // with a real resize, but it used to trigger this exact same "measure
    // everything and flip" pass anyway — read as a stray card position
    // drift and animated, which is the janky unrelated-transition-while-
    // scrolling bug this guard exists to kill. Only a genuine WIDTH change
    // still runs it.
    let lastWidth = container.getBoundingClientRect().width;
    // ResizeObserver can call back more than once for the same visual frame
    // (browsers batch differently, and this same render can ALSO have just
    // run the measure-and-flip pass above from an unrelated state update —
    // useActivePlatform's IntersectionObserver re-rendering LocalLibrary as
    // sections cross its threshold mid-transition, notably, which fires
    // more often the more of the grid is genuinely reflowing at once, i.e.
    // scrolled deep into a long list). Two independent measure-and-flip
    // passes landing back-to-back for what's really the same underlying
    // reflow raced each other's prevRects updates instead of chaining
    // cleanly, which is what made selecting a game near the bottom (lots of
    // sections reflowing, lots of IntersectionObserver churn) look chaotic
    // while the same click up top (barely anything crossing the threshold)
    // didn't. Coalescing every notification within one animation frame into
    // a single pass — last one before paint wins — keeps this to at most
    // one measure-and-flip per frame no matter how many separate triggers
    // fired into it.
    let rafId: number | null = null;
    const ro = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? container.getBoundingClientRect().width;
      if (width === lastWidth) return;
      lastWidth = width;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const current = Array.from(container.querySelectorAll<HTMLElement>(itemSelector));
        flip(current, prevRects.current);
        prevRects.current = new Map(current.map(el => [el, measure(el)]));
      });
    });
    ro.observe(container);
    return () => {
      ro.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  });
}
