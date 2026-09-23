// Whether the built-in player modal (components/player/PlayerModal) is up.
// Module-level store, like playback-service's own, so it survives Astro
// page swaps and any mounted bar can render the modal from it.

import { createExternalStore } from '../shared/state/external-store';

export const playerModalStore = createExternalStore<boolean>(false);

export function openPlayerModal(): void {
  if (!playerModalStore.get()) playerModalStore.set(true);
}

export function closePlayerModal(): void {
  if (playerModalStore.get()) playerModalStore.set(false);
}
