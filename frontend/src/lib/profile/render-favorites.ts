import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { FavoritesSection } from '../../components/profile/FavoritesSection';

// The Favorites tab is a React island mounted imperatively — profile.astro
// still drives tab switching by calling renderFavorites(el) and replacing
// el's innerHTML wholesale on every switch, which would otherwise orphan
// the previous React root without unmounting it.
let root: Root | null = null;

export async function renderFavorites(el: HTMLElement): Promise<void> {
  root?.unmount();
  root = createRoot(el);
  root.render(createElement(FavoritesSection));
}
