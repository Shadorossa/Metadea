import { useSyncExternalStore } from 'react';

const subscribeNoop = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// "Has this island finished hydrating?" — false during Astro's server render
// and during the hydration pass (so server and client markup agree), true
// from the first client-only render on. Replaces the
// `useState(false)` + `useEffect(() => setMounted(true), [])` pair that
// every island used to repeat: same server/hydration output, without a
// state write inside an effect.
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNoop, clientSnapshot, serverSnapshot);
}
