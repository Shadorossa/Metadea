import { useSyncExternalStore } from 'react';
import type { ExternalStore } from '../../../lib/shared/state/external-store';

// Re-renders the calling component on every store.set(). Astro's server-side
// pass has no client singleton to read yet, so it always reports the store's
// pristine initial value, the same as a fresh module load would.
export function useExternalStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, () => store.initial);
}
