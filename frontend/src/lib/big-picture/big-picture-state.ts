// Whether Big Picture is open. A module-level store so the header button,
// the shortcut and the gamepad Guide watcher (all in different places of
// the Local page) toggle one shared state instead of threading callbacks.
import { createExternalStore } from '../shared/state/external-store';

export const bigPictureStore = createExternalStore<boolean>(false);

export function openBigPicture(): void {
  if (!bigPictureStore.get()) bigPictureStore.set(true);
}

export function closeBigPicture(): void {
  if (bigPictureStore.get()) bigPictureStore.set(false);
}

export function toggleBigPicture(): void {
  bigPictureStore.set(!bigPictureStore.get());
}
