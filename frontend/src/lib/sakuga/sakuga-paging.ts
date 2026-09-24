// Paging, merging and ordering for Sakugabooru clip lists. Every list is
// sorted by votes on the server (`order:score`); these helpers decide which
// page to ask for next and when the list is complete.
//
// The first request of a strip is small (12) so a page full of rows costs
// little; later ones are 24. Moebooru pages are `offset = (page - 1) *
// limit`, so the next request always uses a size that divides what is
// already loaded: 12 → (page 2, 12) → 24 → (page 2, 24) → 48 → (page 3, 24)…

import type { SakugaPost, SakugaPostPage, SakugaTag } from '../tauri/sakuga';
import { stripSeasonSuffix } from '../media/mappers/mapper-utils';

export const SAKUGA_FIRST_PAGE_SIZE = 12;
export const SAKUGA_PAGE_SIZE = 24;

export interface SakugaPageRequest {
  page: number;
  limit: number;
}

/** The request that continues right after `fetched` server rows, or null
 *  when `fetched` isn't a page boundary (a short page: the list ended). */
export function nextSakugaPageRequest(
  fetched: number,
  firstPageSize = SAKUGA_FIRST_PAGE_SIZE,
  pageSize = SAKUGA_PAGE_SIZE,
): SakugaPageRequest | null {
  if (fetched <= 0) return { page: 1, limit: firstPageSize };
  for (const limit of [pageSize, firstPageSize]) {
    if (fetched % limit === 0) return { page: fetched / limit + 1, limit };
  }
  return null;
}

export interface SakugaPagerState {
  posts: SakugaPost[];
  /** Server rows consumed so far (before the rating filter). */
  fetched: number;
  /** Matches across all pages; null before the first page. */
  total: number | null;
  done: boolean;
}

export const EMPTY_SAKUGA_PAGER: SakugaPagerState = { posts: [], fetched: 0, total: null, done: false };

/** Whether nothing more is left to load after `page`. */
export function isSakugaEndReached(fetched: number, total: number, page: Pick<SakugaPostPage, 'rawCount' | 'limit'>): boolean {
  return fetched >= total || page.rawCount < page.limit || page.rawCount === 0;
}

/** Appends ids not yet listed, keeping order (votes shift between pages). */
export function mergeSakugaPosts(existing: SakugaPost[], incoming: SakugaPost[]): SakugaPost[] {
  const seen = new Set(existing.map(post => post.id));
  const added: SakugaPost[] = [];
  for (const post of incoming) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    added.push(post);
  }
  return added.length > 0 ? [...existing, ...added] : existing;
}

/** Folds one fetched page into the pager. A failed fetch (null) ends the
 *  list quietly: what's loaded stays, nothing is retried in a loop. */
export function applySakugaPage(state: SakugaPagerState, page: SakugaPostPage | null): SakugaPagerState {
  if (!page) return { ...state, done: true };
  const fetched = state.fetched + page.rawCount;
  return {
    posts: mergeSakugaPosts(state.posts, page.posts),
    fetched,
    total: page.total,
    done: isSakugaEndReached(fetched, page.total, page),
  };
}

// ── One-row pages (creator page) ────────────────────────────────────────────
// The creator page shows a single row of clips; a page is one row, so the
// page size is however many cards fit. Cards are at least this wide (about a
// works card), with this gap: keep in step with sakuga.css.

export const SAKUGA_ROW_CARD_MIN_PX = 160;
export const SAKUGA_ROW_GAP_PX = 12;

/** Cards that fit in one row of `width` px (at least one). */
export function sakugaRowColumns(width: number, cardMin = SAKUGA_ROW_CARD_MIN_PX, gap = SAKUGA_ROW_GAP_PX): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (cardMin + gap)));
}

/** The 1-based page (of `columns` clips) that shows the clip at `offset`:
 *  resizing keeps the first visible clip on screen. */
export function sakugaRowPage(offset: number, columns: number): number {
  return Math.floor(Math.max(0, offset) / Math.max(1, columns)) + 1;
}

export function sakugaRowPageCount(total: number | null, columns: number): number {
  return total && total > 0 ? Math.ceil(total / Math.max(1, columns)) : 1;
}

// ── Rows on the media page ──────────────────────────────────────────────────

const SAKUGA_ROLE_RE = /key animation|animation director|effects animation|storyboard/i;

/** Staff roles whose people plausibly have clips: Key Animation, (Action /
 *  Chief) Animation Director, Effects Animation, Storyboard. */
export function isSakugaStaffRole(role: string | null | undefined): boolean {
  return !!role && SAKUGA_ROLE_RE.test(role);
}

export interface SakugaRowOrderInput {
  /** Position in the staff list. */
  order: number;
  status: 'pending' | 'ready' | 'empty';
  /** Score of the row's first (most voted) clip. */
  bestScore: number | null;
}

/** Loaded rows by their best clip's score (ties keep staff order), then the
 *  rows still waiting, in staff order; rows without clips are dropped. */
export function orderSakugaRows<T extends SakugaRowOrderInput>(rows: readonly T[]): T[] {
  const ready = rows.filter(row => row.status === 'ready')
    .sort((a, b) => (b.bestScore ?? 0) - (a.bestScore ?? 0) || a.order - b.order);
  const pending = rows.filter(row => row.status === 'pending').sort((a, b) => a.order - b.order);
  return [...ready, ...pending];
}

// ── Tags ────────────────────────────────────────────────────────────────────

/** "my_hero_academia_series" → "My Hero Academia". */
export function humanizeSakugaTag(tag: string): string {
  return tag
    .replace(/_series$/, '')
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Series filter chips from an artist's related copyright tags: a series
 *  and its all-seasons `_series` tag collapse into the latter. */
export function sakugaSeriesChips(related: readonly SakugaTag[], max = 12): SakugaTag[] {
  const names = new Set(related.map(tag => tag.name));
  return related
    .filter(tag => tag.count > 0 && !names.has(`${tag.name}_series`))
    .slice(0, max);
}

/** Titles to look a work's series tag up by, most specific first:
 *  romaji, then English, each also without its season suffix. */
export function sakugaSeriesTitles(titles: { titleRomaji?: string; titleEnglish?: string; titleMain?: string }): string[] {
  const out: string[] = [];
  for (const title of [titles.titleRomaji, titles.titleEnglish, titles.titleMain]) {
    const trimmed = title?.trim();
    if (!trimmed) continue;
    for (const variant of [trimmed, stripSeasonSuffix(trimmed)]) {
      if (!out.some(existing => existing.toLowerCase() === variant.toLowerCase())) out.push(variant);
    }
  }
  return out;
}

/** The series a post belongs to, as a label: the first of `seriesTags`
 *  (most frequent first) that the post carries. */
export function sakugaPostSeries(postTags: string, seriesTags: readonly string[]): string | null {
  if (seriesTags.length === 0) return null;
  const tags = new Set(postTags.split(' '));
  const match = seriesTags.find(tag => tags.has(tag));
  return match ? humanizeSakugaTag(match) : null;
}

export function sakugaPostUrl(id: number): string {
  return `https://www.sakugabooru.com/post/show/${id}`;
}

export function sakugaTagUrl(tag: string): string {
  return `https://www.sakugabooru.com/post?tags=${encodeURIComponent(tag)}`;
}

export function isSakugaVideo(post: Pick<SakugaPost, 'fileExt'>): boolean {
  return post.fileExt === 'mp4' || post.fileExt === 'webm';
}
