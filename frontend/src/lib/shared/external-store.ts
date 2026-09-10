// Minimal module-level "store" — state that lives outside React (so it
// survives Astro page transitions the same way any other imported module's
// state does) plus a useSyncExternalStore-backed hook to read it reactively.
// playback-service.ts (video) and reading-session.ts (reading) each used to
// hand-roll this exact same state/listeners/notify/subscribe/get scaffolding
// around their own, very different, domain logic (VLC polling and queue
// advancement vs. a static paused-reader snapshot) — this factors out just
// the shared plumbing, not any of that domain logic.
import { useSyncExternalStore } from 'react';

export interface ExternalStore<T> {
  get: () => T;
  /** Replaces the value and notifies every subscriber. */
  set: (next: T) => void;
  subscribe: (cb: () => void) => () => void;
  /** React hook — re-renders the calling component on every set(). */
  use: () => T;
}

export function createExternalStore<T>(initial: T): ExternalStore<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  const get = () => state;

  const set = (next: T) => {
    state = next;
    for (const cb of listeners) cb();
  };

  const subscribe = (cb: () => void) => {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  };

  // Astro's server-side pass has no client singleton to read yet — always
  // reports the same pristine `initial` value a fresh module load would
  // have, same as every store here already did by hardcoding it inline.
  const use = () => useSyncExternalStore(subscribe, get, () => initial);

  return { get, set, subscribe, use };
}
