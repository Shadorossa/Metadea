import { useEffect, useRef, useState } from 'react';

// The "let cancelled = false; ...; return () => { cancelled = true; }" effect
// shape, pulled out of LocalMediaDetailPanel where it was independently
// repeated for every async lookup (season number, edition probe, deep tag
// scan, episode names, resume position, ...). Pure and React-free so it can
// be unit-tested under vitest's node environment: `load` gets an
// AbortSignal it may consult mid-flight (the multi-round-trip loaders check
// it between awaits), and neither callback fires once the returned cleanup
// has run — a loader that ignores the signal still gets exactly the old
// cancelled-guard semantics.
export function runGuarded<T>(
  load: (signal: AbortSignal) => Promise<T>,
  onValue: (value: T) => void,
  onError: (error: unknown) => void,
): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  load(signal).then(
    value => { if (!signal.aborted) onValue(value); },
    error => { if (!signal.aborted) onError(error); },
  );
  return () => controller.abort();
}

export interface AsyncResourceState<T> {
  value: T;
  loading: boolean;
  error: unknown;
}

// Thin React wrapper over runGuarded. `value` starts at `initial`, is
// replaced on every successful load and — like the old effects, which all
// mapped a failure to their own default — falls back to `initial` when a
// load rejects. It is deliberately NOT reset while a re-load is in flight
// (some callers want the previous value to stay on screen until the fresh
// one lands); a caller that wants the old "reset, then load" behaviour
// reads `loading ? initial : value`. `loading` is true from the first
// render until the first load settles, then again for every re-run that a
// change in `deps` triggers. The latest `load` closure is always the one
// invoked, so callers don't need to memoize it.
export function useAsyncResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  initial: T,
): AsyncResourceState<T> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const initialRef = useRef(initial);
  const [state, setState] = useState<AsyncResourceState<T>>({ value: initial, loading: true, error: undefined });

  useEffect(() => {
    setState(s => (s.loading && s.error === undefined) ? s : { ...s, loading: true, error: undefined });
    return runGuarded(
      signal => loadRef.current(signal),
      value => setState({ value, loading: false, error: undefined }),
      error => setState({ value: initialRef.current, loading: false, error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
