// Minimal module-level "store" — state that lives outside React (so it
// survives Astro page transitions the same way any other imported module's
// state does). playback-service.ts (video) and reading-session.ts (reading)
// each used to hand-roll this exact same state/listeners/notify/subscribe/get
// scaffolding around their own, very different, domain logic — this factors
// out just the shared plumbing. The React side (a useSyncExternalStore
// wrapper) lives in components/shared/hooks/useExternalStore.ts so lib/ stays
// free of React.
export interface ExternalStore<T> {
  get: () => T;
  /** Replaces the value and notifies every subscriber. */
  set: (next: T) => void;
  subscribe: (cb: () => void) => () => void;
  /** The value a fresh module load starts from — what SSR reports. */
  initial: T;
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

  return { get, set, subscribe, initial };
}
