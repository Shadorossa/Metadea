import type { SearchResult } from '../index';

const OPENLIBRARY_BASE_URL = 'https://openlibrary.org';
const OPENLIBRARY_COVERS_URL = 'https://covers.openlibrary.org/b/id';

interface OpenLibraryBook {
  key: string;
  title: string;
  cover_i?: number;
  first_publish_year?: number;
  ratings_average?: number;
}

interface OpenLibrarySearchResponse {
  docs?: OpenLibraryBook[];
}

function buildCoverUrl(coverId?: number): string | null {
  return coverId ? `${OPENLIBRARY_COVERS_URL}/${coverId}-M.jpg` : null;
}

export async function searchBooks(searchQuery: string, signal: AbortSignal): Promise<SearchResult[]> {
  const fields = 'key,title,cover_i,first_publish_year,ratings_average';
  const url = `${OPENLIBRARY_BASE_URL}/search.json?q=${encodeURIComponent(searchQuery)}&limit=20&fields=${fields}`;

  const response = await fetch(url, { signal });
  if (!response.ok) return [];

  const data: OpenLibrarySearchResponse = await response.json();

  return (data.docs ?? []).map((book): SearchResult => ({
    externalId: `book:${book.key}`,
    type: 'book',
    format: '',
    source: 'openlibrary',
    titleMain: book.title,
    titleRomaji: null,
    titleNative: null,
    coverUrl: buildCoverUrl(book.cover_i),
    releaseYear: book.first_publish_year ?? null,
    releaseMonth: null,
    releaseDay: null,
    scoreGlobal: book.ratings_average ? Math.round(book.ratings_average * 10) / 10 : null,
  }));
}
