import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { StatsSection } from '../../components/profile/StatsSection';

// The Stats tab is a React island mounted imperatively — profile.astro
// still drives tab switching by calling renderStats(el) and replacing el's
// innerHTML wholesale on every switch, which would otherwise orphan the
// previous React root without unmounting it.
let root: Root | null = null;

export async function renderStats(el: HTMLElement): Promise<void> {
  root?.unmount();
  root = createRoot(el);
  root.render(createElement(StatsSection));
}
