import type { SearchResult, SearchPage } from '../index';
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
  subject?: string[];
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

// OpenLibrary work keys arrive as "/works/OL12345W" — stripped down to just
// "OL12345W" for our own "book:<id>" external_id, matching the short-id
// convention every other provider's external_id already follows.
export function bookIdFromWorkKey(workKey: string): string {
  return workKey.replace(/^\/works\//, '');
}

// Reverses bookIdFromWorkKey — also accepts an already-full key so it's safe
// to call on either a freshly-shortened id or one saved before this format
// change.
function workKeyFromBookId(bookId: string): string {
  return bookId.startsWith('/works/') ? bookId : `/works/${bookId}`;
}

// ── Detail fetchers ───────────────────────────────────────────────────────────

export async function fetchOpenLibWork(workKey: string): Promise<OpenLibWork | null> {
  return fetchJson<OpenLibWork>(`${API_ENDPOINTS.OPENLIBRARY}${workKeyFromBookId(workKey)}.json`);
}

export async function fetchOpenLibAuthor(authorKey: string): Promise<{ name: string; image?: string; key: string } | null> {
  const data = await fetchJson<{ name: string; photos?: number[] }>(`${API_ENDPOINTS.OPENLIBRARY}${authorKey}.json`);
  if (!data) return null;
  // OpenLibrary uses -1 as a sentinel for "this author explicitly has no
  // photo" rather than omitting the field — that's still truthy, so it
  // built a URL like ".../a/id/-1-M.jpg" that 404s, rendering as no image
  // anyway but silently, instead of this just not claiming one at all.
  const photoId = data.photos?.[0];
  const image = photoId && photoId > 0 ? `https://covers.openlibrary.org/a/id/${photoId}-M.jpg` : undefined;
  return { name: data.name, image, key: authorKey };
}

// Comics aren't a distinct type in OpenLibrary's own schema — they're just
// books tagged with a subject like "Comic books, strips", "Cartoons and
// comics", or plain "comic". Any subject containing "comic" (case-insensitive)
// routes the work to the Comics tab instead of Books.
function isComicBook(book: OpenLibraryBook): boolean {
  return (book.subject ?? []).some(s => s.toLowerCase().includes('comic'));
}

// Manga has its own tab (and its own AniList-backed search) — OpenLibrary
// just tags it as a book subject ("Manga", "Manga comics", "Japanese comic
// books", "Japanese Graphic Novels", ...), so without this it leaked into
// the Books results alongside actual novels. Comics search doesn't need
// this: overlapping OpenLibrary listings that are both manga and comic
// already match isComicBook above. Catches two shapes: any subject that
// literally says "manga", or a Japan subject combined with a comic/graphic-
// novel one (OpenLibrary usually splits those across separate subject tags
// rather than one combined string, e.g. ["Graphic novels", "Japan"]).
function isMangaBook(book: OpenLibraryBook): boolean {
  const subjects = (book.subject ?? []).map(s => s.toLowerCase());
  if (subjects.some(s => s.includes('manga'))) return true;
  const mentionsJapan = subjects.some(s => s.includes('japan'));
  const mentionsComicLike = subjects.some(s => s.includes('comic') || s.includes('graphic novel'));
  return mentionsJapan && mentionsComicLike;
}

function mapBook(book: OpenLibraryBook, mediaType: 'book' | 'comic'): SearchResult {
  return {
    externalId:   `${mediaType}:${bookIdFromWorkKey(book.key)}`,
    type:         mediaType,
    format:       '',
    source:       'openlibrary',
    titleMain:    book.title,
    titleRomaji:  null,
    titleNative:  null,
    coverUrl:     buildCoverUrl(book.cover_i),
    releaseYear:  book.first_publish_year ?? null,
    releaseMonth: null,
    releaseDay:   null,
    // OpenLibrary's ratings_average is already a 0-5 scale — every other
    // provider's scoreGlobal is normalized to 0-10 (see SearchResult's own
    // doc comment), and formatAverageScore's default display divides by 2
    // to get back to 5 stars. Passing the raw 0-5 value through unscaled
    // meant a book already rated 4.5/5 got displayed as 2.25/5 — halved
    // twice. *2 here converts it into the same 0-10 convention as AniList/
    // IGDB/TMDB before it ever reaches that shared display logic.
    scoreGlobal:  book.ratings_average ? Math.round(book.ratings_average * 2 * 10) / 10 : null,
    authorNames:  book.author_name ?? null,
    authorKey:    book.author_key?.[0] ?? null,
    // book.subject exists but is too noisy to pass off as "genres" (library
    // classification codes, character names, list-membership tags, ...) —
    // left empty rather than surfacing that noise in a genre filter.
    genres:       [],
  };
}

// One page (50, matching every other provider's own page size) per request
// — this used to loop through every page OpenLibrary had (frequently dozens
// for a broad query, one sequential request each) before returning anything
// at all, which was the main reason book/comic search felt so much slower
// than every other provider (a single request each).
const PAGE_SIZE = 100;

async function searchOpenLibraryDocs(
  searchQuery: string,
  signal: AbortSignal,
  page: number,
): Promise<{ docs: OpenLibraryBook[]; hasMore: boolean }> {
  const fields = 'key,title,cover_i,first_publish_year,ratings_average,author_name,author_key,subject';
  const offset = (page - 1) * PAGE_SIZE;
  const url = `${API_ENDPOINTS.OPENLIBRARY}/search.json?q=${encodeURIComponent(searchQuery)}&limit=${PAGE_SIZE}&offset=${offset}&fields=${fields}`;
  const data = await fetchJson<OpenLibrarySearchResponse>(url, { signal });
  const docs = data?.docs ?? [];
  const hasMore = offset + docs.length < (data?.numFound ?? 0);
  return { docs, hasMore };
}

export async function searchBooks(searchQuery: string, signal: AbortSignal, page = 1): Promise<SearchPage> {
  const { docs, hasMore } = await searchOpenLibraryDocs(searchQuery, signal, page);
  const results = docs.filter(b => b.cover_i && !isComicBook(b) && !isMangaBook(b)).map(b => mapBook(b, 'book'));
  return { results, hasMore };
}

interface OpenLibWorkEntry {
  title: string;
  key: string;
  covers?: number[];
}

// Raw shape of GET /authors/{key}.json — everything OpenLibAuthorDetail
// carries except `works`, which comes from the separate works.json request.
interface OpenLibAuthorDetailRaw {
  name: string;
  birth_date?: string;
  death_date?: string;
  bio?: string | { type: string; value: string };
  photos?: number[];
}

export interface OpenLibAuthorDetail {
  name: string;
  birth_date?: string;
  death_date?: string;
  bio?: string | { type: string; value: string };
  photos?: number[];
  works: OpenLibWorkEntry[];
}

// authorKey arrives as either the bare id ("OL48230A") or the full path
// ("/authors/OL48230A") — the latter is what ends up embedded in this app's
// own external_id (see mediaService.ts, which stores whatever OpenLibrary's
// own Work.authors[].author.key already gives it, unprefixed by us).
// Unconditionally prepending "/authors/" here used to double it up into
// ".../authors//authors/OL48230A.json", which OpenLibrary 303-redirects in a
// way the browser's CORS check then rejects.
function authorKeyPath(authorKey: string): string {
  return authorKey.startsWith('/authors/') ? authorKey : `/authors/${authorKey}`;
}

export async function fetchOpenLibAuthorFullDetail(authorKey: string): Promise<OpenLibAuthorDetail | null> {
  const keyPath = authorKeyPath(authorKey);
  const [detail, worksRes] = await Promise.all([
    fetchJson<OpenLibAuthorDetailRaw>(`${API_ENDPOINTS.OPENLIBRARY}${keyPath}.json`),
    fetchJson<{ entries?: OpenLibWorkEntry[] }>(`${API_ENDPOINTS.OPENLIBRARY}${keyPath}/works.json?limit=50`),
  ]);
  if (!detail) return null;
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

export interface OpenLibEdition {
  key: string;
  title: string;
  covers?: number[];
  publish_date?: string;
  publishers?: string[];
  languages?: { key: string }[];
  physical_format?: string;
  number_of_pages?: number;
}

interface OpenLibEditionsResponse {
  size?: number;
  entries?: OpenLibEdition[];
}

// Fetches all editions with a valid cover (covers[0] > 0) for a given work key.
export async function fetchOpenLibEditions(workId: string): Promise<OpenLibEdition[]> {
  const LIMIT = 50;
  const allEditions: OpenLibEdition[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const url = `${API_ENDPOINTS.OPENLIBRARY}/works/${workId}/editions.json?limit=${LIMIT}&offset=${offset}&fields=key,title,covers,publish_date,publishers,languages,physical_format,number_of_pages`;
    const data = await fetchJson<OpenLibEditionsResponse>(url);
    if (!data) break;

    if (total === Infinity) total = data.size ?? 0;

    const page = data.entries ?? [];
    allEditions.push(...page.filter(e => e.covers?.[0] && e.covers[0] > 0));

    if (page.length < LIMIT) break;
    offset += LIMIT;
  }

  return allEditions;
}
