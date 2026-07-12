import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { ReviewsSection } from '../../components/profile/ReviewsSection';

// The Reviews tab is a React island mounted imperatively — profile.astro
// still drives tab switching by calling renderReviews(el) and replacing
// el's innerHTML wholesale on every switch, which would otherwise orphan
// the previous React root without unmounting it.
let root: Root | null = null;

export async function renderReviews(el: HTMLElement): Promise<void> {
  root?.unmount();
  root = createRoot(el);
  root.render(createElement(ReviewsSection));
}
