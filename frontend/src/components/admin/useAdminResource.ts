import { useCallback, useDeferredValue, useEffect, useReducer, useRef, useState } from 'react';

// The "{items, loading, error, query, deleteTarget}" quintet that every
// catalog admin tab (media, sagas, characters, GitHub files, episodes) used to
// declare by hand, plus the load / confirm-delete flows over it. The state
// transitions live in a pure reducer so they can be unit-tested under
// vitest's node environment without rendering anything.

export interface AdminResourceState<T> {
  items: T[];
  loading: boolean;
  error: unknown;
  query: string;
  deleteTarget: T | null;
}

export type AdminResourceAction<T> =
  | { type: 'load-start' }
  | { type: 'load-success'; items: T[] }
  | { type: 'load-failure'; error: unknown }
  | { type: 'set-query'; query: string }
  | { type: 'set-delete-target'; target: T | null }
  // Looks the item up by key in the current list, so callers can hand a
  // stable `(id) => void` to memoised cards instead of a fresh closure per row.
  | { type: 'request-delete'; key: string }
  | { type: 'remove-item'; key: string };

export function initialAdminResourceState<T>(): AdminResourceState<T> {
  return { items: [], loading: true, error: undefined, query: '', deleteTarget: null };
}

export function adminResourceReducer<T>(
  state: AdminResourceState<T>,
  action: AdminResourceAction<T>,
  key: (item: T) => string,
): AdminResourceState<T> {
  switch (action.type) {
    case 'load-start':
      return { ...state, loading: true, error: undefined };
    case 'load-success':
      return { ...state, items: action.items, loading: false, error: undefined };
    // A failed load empties the list, matching what every tab did before.
    case 'load-failure':
      return { ...state, items: [], loading: false, error: action.error };
    case 'set-query':
      return { ...state, query: action.query };
    case 'set-delete-target':
      return { ...state, deleteTarget: action.target };
    case 'request-delete':
      return { ...state, deleteTarget: state.items.find(item => key(item) === action.key) ?? null };
    case 'remove-item':
      return { ...state, items: state.items.filter(item => key(item) !== action.key), deleteTarget: null };
  }
}

export interface AdminResourceOptions<T> {
  key: (item: T) => string;
  remove?: (item: T) => Promise<void>;
  // Logged (with the error) when `load` / `remove` reject; omitted when the
  // caller already reports the failure itself.
  loadErrorMessage?: string;
  removeErrorMessage?: string;
  onRemoveError?: (error: unknown) => void;
  // The initial load runs when this becomes true (default: on mount).
  enabled?: boolean;
}

export function useAdminResource<T>(load: () => Promise<T[]>, options: AdminResourceOptions<T>) {
  // The latest closures are always the ones invoked, so callers don't need
  // to memoise `load` or the options object.
  const loadRef = useRef(load);
  const optionsRef = useRef(options);
  useEffect(() => {
    loadRef.current = load;
    optionsRef.current = options;
  });
  // The key extractor is captured once — it is a property accessor, not
  // something that changes between renders.
  const [key] = useState(() => options.key);

  const [state, dispatch] = useReducer(
    (current: AdminResourceState<T>, action: AdminResourceAction<T>) => adminResourceReducer(current, action, key),
    undefined,
    initialAdminResourceState<T>,
  );

  const reload = useCallback(async () => {
    dispatch({ type: 'load-start' });
    try {
      dispatch({ type: 'load-success', items: await loadRef.current() });
    } catch (err) {
      const { loadErrorMessage } = optionsRef.current;
      if (loadErrorMessage) console.error(loadErrorMessage, err);
      dispatch({ type: 'load-failure', error: err });
    }
  }, []);

  const enabled = options.enabled ?? true;
  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  const setQuery = useCallback((query: string) => dispatch({ type: 'set-query', query }), []);
  const setDeleteTarget = useCallback((target: T | null) => dispatch({ type: 'set-delete-target', target }), []);
  const requestDelete = useCallback((key: string) => dispatch({ type: 'request-delete', key }), []);
  const cancelDelete = useCallback(() => dispatch({ type: 'set-delete-target', target: null }), []);

  const { deleteTarget } = state;
  const confirmDelete = useCallback(async () => {
    const { remove, key, removeErrorMessage, onRemoveError } = optionsRef.current;
    if (!deleteTarget || !remove) return;
    try {
      await remove(deleteTarget);
      dispatch({ type: 'remove-item', key: key(deleteTarget) });
    } catch (err) {
      if (removeErrorMessage) console.error(removeErrorMessage, err);
      onRemoveError?.(err);
      dispatch({ type: 'set-delete-target', target: null });
    }
  }, [deleteTarget]);

  // Deferred so fast typing doesn't force a full re-filter/re-render of a
  // (potentially large) list on every single keystroke — the input itself
  // stays instantly responsive, the list just settles a beat behind it.
  const deferredQuery = useDeferredValue(state.query);

  return {
    items: state.items,
    loading: state.loading,
    error: state.error,
    query: state.query,
    deferredQuery,
    setQuery,
    deleteTarget,
    setDeleteTarget,
    requestDelete,
    cancelDelete,
    confirmDelete,
    reload,
  };
}

export type AdminResource<T> = ReturnType<typeof useAdminResource<T>>;
