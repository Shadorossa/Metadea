import { API_ENDPOINTS } from '../../../api/endpoints';
import { graphqlPost } from '../../../api/client';
import { getAniListToken } from '../../../tauri/auth';

// Null on any failure — a detail fetch degrades to "nothing from AniList"
// rather than throwing into a page render.
export async function anilistPost<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
  try {
    const { ok, result } = await graphqlPost<T>(API_ENDPOINTS.ANILIST, query, variables);
    if (!ok) return null;
    return result?.data ?? null;
  } catch { return null; }
}

// Search requests use the authenticated token when there is one (allows
// access to private lists / higher rate limits) and fall back to public
// search otherwise.
export function searchRequestOptions(signal: AbortSignal): { signal: AbortSignal; token?: string } {
  const token = getAniListToken();
  return token ? { signal, token } : { signal };
}

export interface PagedEdges<E> { pageInfo: { hasNextPage: boolean; total?: number | null }; edges: E[]; }

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetches every page after the first (already-fetched) one for a paginated
// AniList edge list. Pages are walked one at a time (with a short pause in
// between) instead of firing all of them concurrently — a single hover
// prefetch used to blow through AniList's rate limit by itself on media
// with a large cast (dozens of parallel character-page requests), which then
// 429'd every other AniList call for a while, including unrelated ones like
// the media editor's "import from AniList" button. Sequential fetching still
// retrieves every page, just spread out instead of bursted.
export async function fetchRemainingEdges<E>(
  firstPage: PagedEdges<E>,
  perPage: number,
  fetchPage: (page: number) => Promise<PagedEdges<E> | null>,
): Promise<E[]> {
  if (!firstPage.pageInfo?.hasNextPage) return [];

  const total = firstPage.pageInfo.total;
  const totalPages = total ? Math.ceil(total / perPage) : Infinity;

  const extra: E[] = [];
  let page = 2;
  while (page <= totalPages) {
    const next = await fetchPage(page);
    if (!next) break;
    if (Array.isArray(next.edges)) extra.push(...next.edges);
    if (!next.pageInfo?.hasNextPage) break;
    page++;
    if (page <= totalPages) await delay(150);
  }
  return extra;
}
