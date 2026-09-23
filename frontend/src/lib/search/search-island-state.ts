import type { MediaType, SearchResult } from './index';
import type { ApiSportsDiscipline } from './providers/apisports';
import { SEARCH_TAB_TYPES } from '../media/media-types';
import { STORAGE_KEYS } from '../storage/storage-keys';

export type SearchStatus = 'idle' | 'loading' | 'done' | 'error' | 'missing-keys';

// Restores the last search when landing on /search with no ?q (the navbar's
// search link is a bare href, so clicking back into a media page's detail
// view and returning here would otherwise always reset). sessionStorage
// (not localStorage) so it naturally clears per-tab; Home/Profile also clear
// it explicitly on visit so it doesn't outlive an actual change of section.
export interface PersistedSearchState {
  query: string;
  mediaType: MediaType;
  eventDiscipline?: ApiSportsDiscipline | '';
  eventSeasonsUnified?: boolean;
  results: SearchResult[];
  status: SearchStatus;
  page: number;
  hasMore: boolean;
  sortField: 'releaseDate' | 'scoreGlobal';
  sortDirection: 'asc' | 'desc';
}

export function loadPersistedSearchState(): PersistedSearchState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEYS.searchState);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSearchState;
    return parsed.query ? parsed : null;
  } catch {
    return null;
  }
}

// search.astro reads ?q=/?type= via Astro.url.searchParams, but this page is
// statically prerendered (no `output: 'server'`) — that query string is
// always empty at build time, so initialQuery/initialType (and the SSR'd
// markup built from them) never reflect the real runtime URL. Reading
// window.location.search directly during the initial render (e.g. via a
// lazy useState initializer) would fix that, but it makes the very first
// client render diverge from the server-rendered HTML, which is a React
// hydration-mismatch error, not just cosmetically wrong markup — so this is
// read in a mount effect instead (after hydration), matching SSR on the
// first render and correcting it a tick later, same as the existing
// persisted-search-state restore just below it.
export function getUrlSearchParams(): { query: string; mediaType: MediaType; eventDiscipline: ApiSportsDiscipline | '' } | null {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if (!q) return null;
  const rawType = params.get('type');
  const mediaType: MediaType = rawType && (SEARCH_TAB_TYPES as readonly string[]).includes(rawType) ? rawType as MediaType : 'all';
  const rawDiscipline = params.get('discipline');
  const eventDiscipline: ApiSportsDiscipline | '' = rawDiscipline === 'football' || rawDiscipline === 'basketball' ? rawDiscipline : '';
  return { query: q, mediaType, eventDiscipline };
}

// Mirrors .results-grid's own breakpoints (search.css) so Todos' per-type
// sections can cap themselves to exactly one row — row height there is
// fluid (each card's height is proportional to its own 1fr width, which
// changes with the column count), so a fixed CSS max-height can't do this
// on its own the way it could for a fixed-height row.
const RESULTS_GRID_BREAKPOINTS: Array<[minWidth: number, columns: number]> = [
  [1280, 12], [1024, 10], [768, 8], [640, 7], [480, 6],
];
export function getResultsGridColumns(): number {
  const w = window.innerWidth;
  for (const [minWidth, columns] of RESULTS_GRID_BREAKPOINTS) {
    if (w >= minWidth) return columns;
  }
  return 5;
}
