import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ComponentType } from 'react';

// A React island mounted imperatively into a string-rendered page (see
// profile.astro's switchTab) — the page replaces el's innerHTML wholesale on
// every tab switch, which would otherwise orphan the previous React root
// without unmounting it. Tracked per DOM element (not per renderer
// instance): profile.astro's tabs each get their own createIslandRenderer
// (renderFavorites, renderLibrary, ...), but every one of them mounts onto
// the *same* #profile-tab-content container — a renderer-local `root`
// variable only knows about roots *it* created, so switching from one tab
// to another called a different renderer whose own `root` was still null,
// letting it call createRoot() on a node another renderer's root was still
// attached to (React's "already passed to createRoot()" warning, and two
// competing roots silently fighting over the same node). Keying off the
// element itself means whichever renderer runs next always finds and tears
// down whatever's actually there, regardless of which renderer put it there.
const rootsByElement = new WeakMap<HTMLElement, Root>();

export function createIslandRenderer<P extends object = Record<string, never>>(
  Component: ComponentType<P>,
) {
  return async (el: HTMLElement, props?: P): Promise<void> => {
    rootsByElement.get(el)?.unmount();
    const root = createRoot(el);
    rootsByElement.set(el, root);
    root.render(createElement(Component, props as P));
  };
}
