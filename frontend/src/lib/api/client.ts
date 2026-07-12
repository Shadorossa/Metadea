/**
 * Uniform fetch helpers shared by every external API provider.
 * Centralizes request construction and error handling that used to be
 * duplicated across each provider file (AniList, TMDB, Open Library, ...).
 */

export interface FetchJsonOptions extends RequestInit {
  /** Aborts the request after this many ms if no signal was already provided. */
  timeoutMs?: number;
}

/**
 * Fetches a URL and parses the JSON response.
 * Returns null on any failure (network error, non-OK status, invalid JSON)
 * instead of throwing — matches the "silent fail" behavior most search
 * providers rely on.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T | null> {
  const { timeoutMs, signal, ...init } = options;
  const controller = timeoutMs && !signal ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(url, { ...init, signal: signal ?? controller?.signal });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface GraphQLResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * POSTs a GraphQL query/variables pair to `endpoint` with the standard JSON
 * headers, optionally authenticated with a bearer token. Never throws on its
 * own — callers decide how to react to a non-OK status or GraphQL errors.
 */
export async function graphqlPost<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
  opts: { token?: string; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; status: number; result: GraphQLResult<T> | null }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(variables !== undefined ? { query, variables } : { query }),
    signal: opts.signal,
  });

  let result: GraphQLResult<T> | null = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  return { ok: response.ok, status: response.status, result };
}
