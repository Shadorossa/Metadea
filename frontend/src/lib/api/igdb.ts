import { API_URL } from '../config';
import type { MediaType, SearchResult } from '../search';

export async function searchGames(
  searchQuery: string,
  mediaType: MediaType,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = `${API_URL}/api/search/games?q=${encodeURIComponent(searchQuery)}&type=${mediaType}`;
  const response = await fetch(url, { signal });

  if (!response.ok) return [];
  const data = await response.json() as { results?: SearchResult[] };
  return data.results ?? [];
}
