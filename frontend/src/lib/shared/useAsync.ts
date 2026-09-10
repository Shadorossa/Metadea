import { useEffect, useRef, useState, useCallback } from 'react';

export interface UseAsyncResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: (silent?: boolean) => Promise<void>;
}

// Generic async hook consolidating repetitive error handling + cancellation
// across local media hooks and API calls. Handles AbortSignal cancellation
// automatically to prevent state updates after unmount.
export function useAsync<T>(
  asyncFn: (signal: AbortSignal) => Promise<T>,
  defaultValue: T | null = null,
  deps: React.DependencyList = [],
): UseAsyncResult<T> {
  const [data, setData] = useState<T | null>(defaultValue);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const execute = useCallback(
    async (silent = false) => {
      const controller = new AbortController();
      cancelledRef.current = false;

      if (!silent) setLoading(true);
      setError(null);

      try {
        const result = await asyncFn(controller.signal);
        if (!cancelledRef.current) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (!cancelledRef.current && !(err instanceof DOMException && err.name === 'AbortError')) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          setError(errorMsg);
          setData(defaultValue);
        }
      } finally {
        if (!cancelledRef.current && !silent) {
          setLoading(false);
        }
      }
    },
    [asyncFn, defaultValue],
  );

  useEffect(() => {
    cancelledRef.current = false;
    execute();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    data,
    loading,
    error,
    refetch: (silent?: boolean) => execute(silent),
  };
}

// Simpler variant: fire-and-forget async with no result tracking (just error/loading).
// Used for mutations like "mark as watched" where you don't need to track the result.
export function useAsyncEffect(
  asyncFn: (signal: AbortSignal) => Promise<void>,
  deps: React.DependencyList = [],
): { loading: boolean; error: string | null } {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    cancelledRef.current = false;
    setLoading(true);

    asyncFn(controller.signal)
      .catch(err => {
        if (!cancelledRef.current && !(err instanceof DOMException && err.name === 'AbortError')) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          setError(errorMsg);
        }
      })
      .finally(() => {
        if (!cancelledRef.current) setLoading(false);
      });

    return () => {
      cancelledRef.current = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { loading, error };
}
