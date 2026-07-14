import { createRoot, type Root } from 'react-dom/client';
import { createElement, type ComponentType } from 'react';

// A React island mounted imperatively into a string-rendered page (see
// profile.astro's switchTab) — the page replaces el's innerHTML wholesale on
// every tab switch, which would otherwise orphan the previous React root
// without unmounting it. One root per renderer instance, torn down and
// recreated on every call.
export function createIslandRenderer<P extends object = Record<string, never>>(
  Component: ComponentType<P>,
) {
  let root: Root | null = null;
  return async (el: HTMLElement, props?: P): Promise<void> => {
    root?.unmount();
    root = createRoot(el);
    root.render(createElement(Component, props as P));
  };
}
