import type { SearchResult } from '../index';

const OPENLIBRARY_BASE_URL   = 'https://openlibrary.org';
const OPENLIBRARY_COVERS_URL = 'https://covers.openlibrary.org/b/id';

interface OpenLibraryBook {
  key: string;
  title: string;
  cover_i?: number;
  first_publish_year?: number;
  ratings_average?: number;
  author_name?: string[];
  author_key?: string[];
}

interface OpenLibrarySearchResponse {
  docs?: OpenLibraryBook[];
}

// ── Detail types ──────────────────────────────────────────────────────────────

export interface OpenLibWork {
  key: string;
  title: string;
  description?: string | { type: string; value: string };
  subjects?: string[];
  covers?: number[];
  authors?: { author: { key: string } }[];
  first_publish_date?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildCoverUrl(coverId?: number, size: 'S' | 'M' | 'L' = 'M'): string | null {
  return coverId ? `${OPENLIBRARY_COVERS_URL}/${coverId}-${size}.jpg` : null;
}

export function openLibCoverUrl(coverId: number, size: 'S' | 'M' | 'L' = 'L'): string {
  return `${OPENLIBRARY_COVERS_URL}/${coverId}-${size}.jpg`;
}

// ── Detail fetchers ───────────────────────────────────────────────────────────

export async function fetchOpenLibWork(workKey: string): Promise<OpenLibWork | null> {
  try {
    const res = await fetch(`${OPENLIBRARY_BASE_URL}${workKey}.json`);
    if (!res.ok) return null;
    return res.json() as Promise<OpenLibWork>;
  } catch { return null; }
}

export async function fetchOpenLibAuthor(authorKey: string): Promise<string | null> {
  try {
    const res = await fetch(`${OPENLIBRARY_BASE_URL}${authorKey}.json`);
    if (!res.ok) return null;
    const data = await res.json() as { name: string };
    return data.name ?? null;
  } catch { return null; }
}

export async function searchBooks(searchQuery: string, signal: AbortSignal): Promise<SearchResult[]> {
  const fields = 'key,title,cover_i,first_publish_year,ratings_average,author_name,author_key';
  const url = `${OPENLIBRARY_BASE_URL}/search.json?q=${encodeURIComponent(searchQuery)}&limit=20&fields=${fields}`;

  const response = await fetch(url, { signal });
  if (!response.ok) return [];

  const data: OpenLibrarySearchResponse = await response.json();

  return (data.docs ?? []).map((book): SearchResult => ({
    externalId:  `book:${book.key}`,
    type:        'book',
    format:      '',
    source:      'openlibrary',
    titleMain:   book.title,
    titleRomaji: null,
    titleNative: null,
    coverUrl:    buildCoverUrl(book.cover_i),
    releaseYear: book.first_publish_year ?? null,
    releaseMonth: null,
    releaseDay:   null,
    scoreGlobal: book.ratings_average ? Math.round(book.ratings_average * 10) / 10 : null,
    authorNames: book.author_name ?? null,
    authorKey:   book.author_key?.[0] ?? null,
  }));
}
