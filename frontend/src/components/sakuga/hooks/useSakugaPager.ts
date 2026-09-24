import { useCallback, useEffect, useRef, useState } from 'react';
import { getSakugaPosts } from '../../../lib/tauri/sakuga';
import { isAdultContentEnabled } from '../../../lib/storage/preferences';
import {
  EMPTY_SAKUGA_PAGER,
  SAKUGA_FIRST_PAGE_SIZE,
  SAKUGA_PAGE_SIZE,
  applySakugaPage,
  nextSakugaPageRequest,
  type SakugaPagerState,
} from '../../../lib/sakuga/sakuga-paging';

export interface SakugaPager {
  state: SakugaPagerState;
  loading: boolean;
  /** Fetches the next page unless one is in flight or the list is done.
   *  Resolves once it has been folded in. */
  loadMore: () => Promise<void>;
}

interface Run {
  key: string;
  state: SakugaPagerState;
  inFlight: Promise<void> | null;
}

/** Paged, vote-ordered posts for `tags` (null: nothing to load yet). The
 *  first page loads as soon as `tags` is set. Changing `tags` starts over. */
export function useSakugaPager(
  tags: readonly string[] | null,
  { firstPageSize = SAKUGA_FIRST_PAGE_SIZE, pageSize = SAKUGA_PAGE_SIZE } = {},
): SakugaPager {
  const tagsKey = tags ? tags.join(' ') : '';
  const run = useRef<Run>({ key: '', state: EMPTY_SAKUGA_PAGER, inFlight: null });
  const [view, setView] = useState<{ key: string; state: SakugaPagerState; loading: boolean }>(
    { key: '', state: EMPTY_SAKUGA_PAGER, loading: false },
  );

  const loadMore = useCallback((): Promise<void> => {
    if (!tagsKey) return Promise.resolve();
    if (run.current.key !== tagsKey) run.current = { key: tagsKey, state: EMPTY_SAKUGA_PAGER, inFlight: null };
    const current = run.current;
    if (current.inFlight) return current.inFlight;
    if (current.state.done) return Promise.resolve();
    const request = nextSakugaPageRequest(current.state.fetched, firstPageSize, pageSize);
    if (!request) {
      current.state = { ...current.state, done: true };
      setView({ key: tagsKey, state: current.state, loading: false });
      return Promise.resolve();
    }
    setView({ key: tagsKey, state: current.state, loading: true });
    const promise = getSakugaPosts(tagsKey.split(' '), request.page, request.limit, isAdultContentEnabled())
      .then(page => {
        if (run.current === current) current.state = applySakugaPage(current.state, page);
      })
      .finally(() => {
        if (run.current !== current) return;
        current.inFlight = null;
        setView({ key: tagsKey, state: current.state, loading: false });
      });
    current.inFlight = promise;
    return promise;
  }, [tagsKey, firstPageSize, pageSize]);

  useEffect(() => {
    if (tagsKey && run.current.key !== tagsKey) void loadMore();
  }, [tagsKey, loadMore]);

  const fresh = view.key === tagsKey;
  return { state: fresh ? view.state : EMPTY_SAKUGA_PAGER, loading: fresh && view.loading, loadMore };
}
