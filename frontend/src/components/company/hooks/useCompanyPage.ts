import { useEffect, useState } from 'react';
import { getCompanyPage, loadMoreCompanyWorks, type CompanyPagePayload } from '../../../lib/tauri/company-catalog';
import { isCompanyPageId } from '../../../lib/company/company-page-id';

export type CompanyPageState =
  | { status: 'loading' }
  // `failed` carries the command's error (an E_COMPANY_* code) for
  // formatAppError; the page picks the strings, so this hook needs none.
  | { status: 'error'; reason: 'missing_id' | 'desktop_only' | 'failed'; cause?: unknown }
  | {
      status: 'ready';
      payload: CompanyPagePayload;
      /** A stale copy is on screen while the provider is asked again. */
      refreshing: boolean;
      /** The refresh failed: what's on screen is the saved copy. */
      cachedOnly: boolean;
      /** More works are still arriving from the provider. */
      loadingMore: boolean;
    };

// Every call resumes from the cursor Rust keeps; bounded so a provider that
// never reports its last page can't keep the page loading forever.
const MAX_CHUNKS = 400;

async function drain(
  id: string,
  first: CompanyPagePayload,
  isCancelled: () => boolean,
  onChunk: (payload: CompanyPagePayload) => void,
): Promise<CompanyPagePayload> {
  let current = first;
  for (let i = 0; i < MAX_CHUNKS && !current.complete && !isCancelled(); i++) {
    const next = await loadMoreCompanyWorks(id);
    if (!next) break;
    current = next;
    onChunk(current);
  }
  return current;
}

// Loads a company page stale-while-revalidate: the cached copy renders at
// once; a copy past its TTL is refreshed in the background and swapped in
// only once complete, so the grid never shrinks mid-scroll. Works beyond
// the provider's first page stream in chunk by chunk.
export function useCompanyPage(): CompanyPageState {
  const [state, setState] = useState<CompanyPageState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    const id = new URLSearchParams(window.location.search).get('id') ?? '';

    const ready = (payload: CompanyPagePayload, extra: Partial<Extract<CompanyPageState, { status: 'ready' }>> = {}) => {
      if (!cancelled) setState({ status: 'ready', payload, refreshing: false, cachedOnly: false, loadingMore: false, ...extra });
    };

    (async () => {
      if (!isCompanyPageId(id)) {
        setState({ status: 'error', reason: 'missing_id' });
        return;
      }
      let initial: CompanyPagePayload | null;
      try {
        initial = await getCompanyPage(id, false);
      } catch (err) {
        if (!cancelled) setState({ status: 'error', reason: 'failed', cause: err });
        return;
      }
      if (!initial) {
        if (!cancelled) setState({ status: 'error', reason: 'desktop_only' });
        return;
      }

      if (!initial.stale) {
        ready(initial, { loadingMore: !initial.complete });
        const done = await drain(id, initial, isCancelled, chunk => ready(chunk, { loadingMore: !chunk.complete }))
          .catch(() => null);
        if (done) ready(done);
        else setState(prev => (prev.status === 'ready' ? { ...prev, loadingMore: false } : prev));
        return;
      }

      ready(initial, { refreshing: true });
      try {
        const fresh = await getCompanyPage(id, true);
        if (!fresh || fresh.stale) {
          ready(initial, { cachedOnly: true });
          return;
        }
        const done = await drain(id, fresh, isCancelled, () => {});
        ready(done);
      } catch {
        ready(initial, { cachedOnly: true });
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return state;
}
