/**
 * Uniform fetch helpers shared by every external API provider.
 * Centralizes request construction and error handling that used to be
 * duplicated across each provider file (AniList, TMDB, Open Library, ...).
 */

import { API_ENDPOINTS } from './endpoints';
import { anilistRateLimiter, acquireForUrl, reportRateLimited, type RequestPriority } from './rate-limiter';
import { logSearchRequest } from './request-log';

export interface FetchJsonOptions extends RequestInit {
  /** Aborts the request after this many ms if no signal was already provided. */
  timeoutMs?: number;
  /** Queue position on the host's budget — a user-typed search outranks a
   *  background enrichment. Defaults to 'user'. (Named apart from
   *  RequestInit's own `priority`, the browser's fetch priority hint.) */
  budgetPriority?: RequestPriority;
}

// Without this, a hanging provider (e.g. OpenLibrary) blocked until the OS's
// own TCP timeout (60-130s), dragging down the whole "all types" search.
const DEFAULT_TIMEOUT_MS = 8000;

/** Returns null on any failure (network error, non-OK status, invalid JSON)
 *  instead of throwing — matches most search providers' silent-fail behavior. */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T | null> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: externalSignal, budgetPriority = 'user', ...init } = options;

  // Every budgeted host (see HOST_BUDGETS) queues here BEFORE the request's
  // own timeout timer starts — a queued wait can outlast DEFAULT_TIMEOUT_MS
  // on its own. A caller that cancels while still queued never takes a
  // slot; that rejection is reported as null like any other failure.
  try {
    await acquireForUrl(url, budgetPriority, externalSignal ?? undefined);
  } catch {
    return null;
  }

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
    logSearchRequest(url);
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.status === 429) reportRateLimited(url, response.headers.get('Retry-After'));
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
  opts: { token?: string; signal?: AbortSignal; timeoutMs?: number; priority?: RequestPriority } = {},
): Promise<{ ok: boolean; status: number; result: GraphQLResult<T> | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  // graphqlPost is currently only ever called against AniList's own
  // endpoint — gated on it explicitly (rather than unconditionally) so a
  // future second GraphQL provider added here doesn't silently inherit
  // AniList's own rate budget. Must run BEFORE the request's own timeout
  // timer starts below — a queued wait here can take longer than
  // DEFAULT_TIMEOUT_MS on its own, which would otherwise abort the request
  // before it even had a chance to fire.
  // A cancellation while still queued rejects with AbortError here, exactly
  // like a cancellation mid-flight would below — and without ever having
  // taken a slot from the budget.
  if (endpoint === API_ENDPOINTS.ANILIST) {
    await anilistRateLimiter.acquire(opts.priority ?? 'user', opts.signal);
  }

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
    logSearchRequest(endpoint);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(variables !== undefined ? { query, variables } : { query }),
      signal: controller.signal,
    });

    if (response.status === 429) reportRateLimited(endpoint, response.headers.get('Retry-After'));

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
