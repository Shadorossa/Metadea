/**
 * Uniform fetch helpers shared by every external API provider.
 * Centralizes request construction and error handling that used to be
 * duplicated across each provider file (AniList, TMDB, Open Library, ...).
 */

export interface FetchJsonOptions extends RequestInit {
  /** Aborts the request after this many ms if no signal was already provided. */
  timeoutMs?: number;
}

// Without this, a hanging provider (e.g. OpenLibrary) blocked until the OS's
// own TCP timeout (60-130s), dragging down the whole "all types" search.
const DEFAULT_TIMEOUT_MS = 8000;

/** Returns null on any failure (network error, non-OK status, invalid JSON)
 *  instead of throwing — matches most search providers' silent-fail behavior. */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T | null> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, ...init } = options;

  // Always run our own timeout, merged with any external (e.g. cancel-on-
  // new-query) signal — previously an external signal being present
  // disabled the timeout entirely, so a slow/hung provider ignored it as
  // long as the search itself hadn't been cancelled.
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

export interface GraphQLResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/** POSTs a GraphQL query/variables pair. Doesn't throw for a non-OK status,
 *  GraphQL errors, or its own timeout — but a caller-provided `signal`
 *  aborting (genuine cancellation) still propagates as a rejection, since
 *  search relies on catching that to avoid overwriting fresher results. */
export async function graphqlPost<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
  opts: { token?: string; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; result: GraphQLResult<T> | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  // Same merged timeout+cancellation as fetchJson — an unreachable AniList
  // used to hang on the OS's own TCP timeout since this had no timeout of
  // its own at all.
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExternalAbort);
  }
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(variables !== undefined ? { query, variables } : { query }),
      signal: controller.signal,
    });

    let result: GraphQLResult<T> | null = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }

    return { ok: response.ok, status: response.status, result };
  } catch (err) {
    if (opts.signal?.aborted) throw err; // real cancellation — let the caller catch it
    return { ok: false, status: 0, result: null }; // our own timeout, or another network failure
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onExternalAbort);
  }
}
