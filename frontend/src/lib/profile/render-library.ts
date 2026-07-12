import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { LibrarySection } from '../../components/profile/LibrarySection';

// The Library tab is a React island mounted imperatively — profile.astro
// still drives tab switching (and the 'refresh-profile-library' event) by
// calling renderLibrary(el) and replacing el's innerHTML wholesale, which
// would otherwise orphan the previous React root without unmounting it.
let root: Root | null = null;

export async function renderLibrary(el: HTMLElement): Promise<void> {
  root?.unmount();
  root = createRoot(el);
  root.render(createElement(LibrarySection));
}
