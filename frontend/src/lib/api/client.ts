/**
 * Uniform fetch helpers shared by every external API provider.
 * Centralizes request construction and error handling that used to be
 * duplicated across each provider file (AniList, TMDB, Open Library, ...).
 */

export class ApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

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

/**
 * Same as fetchJson, but throws an ApiError instead of swallowing failures —
 * for call sites that need to surface the error to the user.
 */
export async function fetchJsonOrThrow<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new ApiError(`Request failed: ${response.status} ${response.statusText}`, response.status);
  }
  return await response.json() as T;
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
