import type { SearchResult } from '../index';
import { API_ENDPOINTS } from '../../api/endpoints';
import { fetchJson } from '../../api/client';

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
  numFound?: number;
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
  return coverId ? `${API_ENDPOINTS.OPENLIBRARY_COVERS}/${coverId}-${size}.jpg` : null;
}

export function openLibCoverUrl(coverId: number, size: 'S' | 'M' | 'L' = 'L'): string {
  return `${API_ENDPOINTS.OPENLIBRARY_COVERS}/${coverId}-${size}.jpg`;
}

// ── Detail fetchers ───────────────────────────────────────────────────────────

export async function fetchOpenLibWork(workKey: string): Promise<OpenLibWork | null> {
  return fetchJson<OpenLibWork>(`${API_ENDPOINTS.OPENLIBRARY}${workKey}.json`);
}

export async function fetchOpenLibAuthor(authorKey: string): Promise<{ name: string; image?: string; key: string } | null> {
  const data = await fetchJson<{ name: string; photos?: number[] }>(`${API_ENDPOINTS.OPENLIBRARY}${authorKey}.json`);
  if (!data) return null;
  const photoId = data.photos?.[0];
  const image = photoId ? `https://covers.openlibrary.org/a/id/${photoId}-M.jpg` : undefined;
  return { name: data.name, image, key: authorKey };
}

function mapBook(book: OpenLibraryBook): SearchResult {
  return {
    externalId:   `book:${book.key}`,
    type:         'book',
    format:       '',
    source:       'openlibrary',
    titleMain:    book.title,
    titleRomaji:  null,
    titleNative:  null,
    coverUrl:     buildCoverUrl(book.cover_i),
    releaseYear:  book.first_publish_year ?? null,
    releaseMonth: null,
    releaseDay:   null,
    scoreGlobal:  book.ratings_average ? Math.round(book.ratings_average * 10) / 10 : null,
    authorNames:  book.author_name ?? null,
    authorKey:    book.author_key?.[0] ?? null,
  };
}

export async function searchBooks(searchQuery: string, signal: AbortSignal): Promise<SearchResult[]> {
  const fields = 'key,title,cover_i,first_publish_year,ratings_average,author_name,author_key';
  const PAGE = 100;
  const results: SearchResult[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const url = `${API_ENDPOINTS.OPENLIBRARY}/search.json?q=${encodeURIComponent(searchQuery)}&limit=${PAGE}&offset=${offset}&fields=${fields}`;
    const data = await fetchJson<OpenLibrarySearchResponse>(url, { signal });
    if (!data) break;

    if (total === Infinity) total = data.numFound ?? 0;

    const docs = data.docs ?? [];
    results.push(...docs.map(mapBook));

    if (docs.length < PAGE) break;
    offset += PAGE;
  }

  return results;
}

export interface OpenLibAuthorDetail {
  name: string;
  birth_date?: string;
  death_date?: string;
  bio?: string | { type: string; value: string };
  photos?: number[];
  works: {
    title: string;
    key: string;
    covers?: number[];
  }[];
}

export async function fetchOpenLibAuthorFullDetail(authorKey: string): Promise<OpenLibAuthorDetail | null> {
  const detail = await fetchJson<any>(`${API_ENDPOINTS.OPENLIBRARY}/authors/${authorKey}.json`);
  if (!detail) return null;
  const worksRes = await fetchJson<{ entries?: any[] }>(`${API_ENDPOINTS.OPENLIBRARY}/authors/${authorKey}/works.json?limit=50`).catch(() => null);
  const works = (worksRes?.entries || []).map(entry => ({
    title: entry.title,
    key: entry.key,
    covers: entry.covers
  }));
  return {
    name: detail.name,
    birth_date: detail.birth_date,
    death_date: detail.death_date,
    bio: detail.bio,
    photos: detail.photos,
    works
  };
}
