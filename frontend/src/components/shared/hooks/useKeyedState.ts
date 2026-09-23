import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

// State that resets to `initial` whenever `key` changes — the "reset X when
// the current id changes" shape that used to be written as
// `useEffect(() => setX(initial), [key])`. Deriving it during render means
// the reset value shows on the very first render of the new key instead of
// one frame later, and there's no state write inside an effect for the
// React Compiler to flag.
//
// `initial` should be a primitive (or a stable reference): it's re-read on
// every render the stored key doesn't match, so a fresh `[]`/`{}` literal
// would hand consumers a new identity each time.
//
// The setter is referentially stable (like useState's), so it can be used
// inside effects without being listed as a dependency. It stamps the write
// with the key current at commit time; a stale async callback that outlives
// a key change should guard itself the usual way (`cancelled` flag), exactly
// as it had to with useState.
export function useKeyedState<V>(key: unknown, initial: V): [V, Dispatch<SetStateAction<V>>] {
  const [stored, setStored] = useState<{ key: unknown; value: V }>({ key, value: initial });
  const value = Object.is(stored.key, key) ? stored.value : initial;

  const keyRef = useRef(key);
  const initialRef = useRef(initial);
  useLayoutEffect(() => {
    keyRef.current = key;
    initialRef.current = initial;
  });

  const setValue = useCallback<Dispatch<SetStateAction<V>>>(next => {
    setStored(previous => {
      const currentKey = keyRef.current;
      const base = Object.is(previous.key, currentKey) ? previous.value : initialRef.current;
      const resolved = typeof next === 'function' ? (next as (current: V) => V)(base) : next;
      return { key: currentKey, value: resolved };
    });
  }, []);

  return [value, setValue];
}
