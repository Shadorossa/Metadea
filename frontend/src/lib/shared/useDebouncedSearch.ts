import { useEffect, useRef, useState } from 'react';

// Shared "type into a box, wait, fire an abortable search" pattern that used
// to be reimplemented near-identically in every search popup (character/
// media/admin pickers) — debounce timer + AbortController + loading flag +
// abort-aware .then/.catch/.finally, differing only in what fetchFn does.
export function useDebouncedSearch<T>(
  query: string,
  fetchFn: (query: string, signal: AbortSignal) => Promise<T[]>,
  deps: React.DependencyList = [],
  delay = 400,
): { results: T[]; isLoading: boolean } {
  const [results, setResults] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  // fetchFn is a fresh closure every render (it captures caller state like
  // typeFilter/provider) — read the latest one from a ref instead of
  // putting it in the effect's own deps, or every render would restart the
  // debounce timer regardless of whether query/deps actually changed.
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsLoading(true);
      fetchFnRef.current(query, controller.signal)
        .then(r => { if (!controller.signal.aborted) setResults(r); })
        .catch(() => { if (!controller.signal.aborted) setResults([]); })
        .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, delay, ...deps]);

  return { results, isLoading };
}

export function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
