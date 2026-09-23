import { useCallback, useEffect, useRef } from 'react';

// The "clear the previous timer, start a new one" debounce shape was
// independently copy-pasted in IgdbPickerModal.tsx and SearchIsland.tsx —
// both call an imperative callback with whatever raw value the user just
// typed, after a fixed delay, with no need for real request cancellation
// (unlike QuickSearchOverlay's own debounce, which drives an AbortController-
// backed fetch from a reactive effect instead of an onChange handler — a
// structurally different shape, deliberately left as its own thing rather
// than forced into this).
//
// callbackRef always points at the latest callback, so a caller doesn't
// need to memoize it themselves to avoid a stale closure — only `delayMs`
// changing recreates the debounced function. Returns [trigger, cancel]:
// most callers only need `trigger`, but SearchIsland's own tab/filter/
// submit handlers need to cancel a pending debounce outright (a stale
// query firing after the user already moved on) without triggering a new
// one — `cancel` covers that without reaching back into the hook's own
// timer ref.
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): [(...args: Args) => void, () => void] {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const trigger = useCallback((...args: Args) => {
    cancel();
    timerRef.current = setTimeout(() => callbackRef.current(...args), delayMs);
  }, [cancel, delayMs]);

  return [trigger, cancel];
}
