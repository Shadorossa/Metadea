import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { search, topRated, type MediaType, type SearchResult, type SeasonId, type SearchFilters, MissingApiKeyError } from '../../lib/search/index';
import { ANILIST_GENRES } from '../../lib/search/providers/anilist';
import { IGDB_GENRES } from '../../lib/search/providers/igdb';
import { TMDB_MOVIE_GENRE_NAMES, TMDB_TV_GENRE_NAMES } from '../../lib/search/providers/tmdb';
import { prefetchMediaData } from '../../lib/media/mediaService';
import { getT } from '../../i18n/client';
import type { Translations } from '../../i18n/index';
import { IconAll, IconAnime, IconManga, IconNovel, IconGame, IconVNovel, IconMovie, IconSeries, IconBook, IconComic, IconCharacter, IconStaff } from '../local/ui/icons';
import { SEARCH_TAB_TYPES, DETAIL_SUPPORTED_TYPES } from '../../lib/constants/media';
import { formatAverageScore, getActiveRatingSystem } from '../../lib/media/rating-utils';
import { STORAGE_KEYS } from '../../lib/shared/storage-keys';

type SearchTranslations = Translations['search'];

// ── Tab icons ────────────────────────────────────────────────────────────────

const TAB_ICONS: Record<MediaType, JSX.Element> = {
  all:       <IconAll />,
  anime:     <IconAnime />,
  manga:     <IconManga />,
  lnovel:    <IconNovel />,
  game:      <IconGame />,
  vnovel:    <IconVNovel />,
  movie:     <IconMovie />,
  series:    <IconSeries />,
  book:      <IconBook />,
  comic:     <IconComic />,
  character: <IconCharacter />,
  staff:     <IconStaff />,
};

const MEDIA_TYPE_IDS = SEARCH_TAB_TYPES as unknown as MediaType[];

type SearchStatus = 'idle' | 'loading' | 'done' | 'error' | 'missing-keys';

const SEASON_ORDER: SeasonId[] = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];
const SEASON_LABELS = (i18n: SearchTranslations): Record<SeasonId, string> => ({
  WINTER: i18n.season_winter,
  SPRING: i18n.season_spring,
  SUMMER: i18n.season_summer,
  FALL: i18n.season_fall,
});

// Every provider caps a single page at (or under) this — see each provider
// file in lib/search/providers. Below this count, there's nothing left to
// page into regardless of what a stale/aggregated hasMore might say.
const SEARCH_PAGE_SIZE = 100;

// Search-provider ids -> the settings page's API-platform sub-tab that
// configures them (see EnvironmentTab.astro's data-platform buttons).
const PROVIDER_SETTINGS_LINK: Record<string, string> = {
  igdb: '/settings?tab=environment&platform=igdb',
  tmdb: '/settings?tab=environment&platform=tmdb',
  comicvine: '/settings?tab=environment&platform=comicvine',
};

// ── In-flight request de-duplication ────────────────────────────────────────
// No result caching — just prevents the exact same type+query from firing
// two overlapping network requests (e.g. debounce and Enter racing each other).
// The entry is removed as soon as the request settles, so nothing is reused
// after the fact; a repeat search always hits the API again.

const inFlightSearches = new Map<string, ReturnType<typeof search>>();

// A fixed genre list per type — not derived from whatever's currently on
// screen, so the filter can search for a genre regardless of whether it
// happens to appear in the current page. Books/comics/character/all have no
// server-side genre support (see providers), so no genre panel at all.
const GENRE_OPTIONS: Partial<Record<MediaType, string[]>> = {
  anime: ANILIST_GENRES,
  manga: ANILIST_GENRES,
  lnovel: ANILIST_GENRES,
  game: IGDB_GENRES,
  vnovel: IGDB_GENRES,
  movie: TMDB_MOVIE_GENRE_NAMES,
  series: TMDB_TV_GENRE_NAMES,
};

interface Props {
  initialQuery?: string;
  initialType?: MediaType;
  i18n: SearchTranslations;
}

function interpolateTemplate(template: string, variables: Record<string, string>): string {
  return Object.entries(variables).reduce(
    (result, [key, value]) => result.replace(`{${key}}`, value),
    template,
  );
}

// Restores the last search when landing on /search with no ?q (the navbar's
// search link is a bare href, so clicking back into a media page's detail
// view and returning here would otherwise always reset). sessionStorage
// (not localStorage) so it naturally clears per-tab; Home/Profile also clear
// it explicitly on visit so it doesn't outlive an actual change of section.
interface PersistedSearchState {
  query: string;
  mediaType: MediaType;
  results: SearchResult[];
  status: SearchStatus;
  page: number;
  hasMore: boolean;
  sortField: 'releaseDate' | 'scoreGlobal';
  sortDirection: 'asc' | 'desc';
}

function loadPersistedSearchState(): PersistedSearchState | null {
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
function getUrlSearchParams(): { query: string; mediaType: MediaType } | null {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if (!q) return null;
  const rawType = params.get('type');
  const mediaType: MediaType = rawType && (MEDIA_TYPE_IDS as string[]).includes(rawType) ? rawType as MediaType : 'all';
  return { query: q, mediaType };
}

// Mirrors .results-grid's own breakpoints (search.css) so Todos' per-type
// sections can cap themselves to exactly one row — row height there is
// fluid (each card's height is proportional to its own 1fr width, which
// changes with the column count), so a fixed CSS max-height can't do this
// on its own the way it could for a fixed-height row.
const RESULTS_GRID_BREAKPOINTS: Array<[minWidth: number, columns: number]> = [
  [1280, 12], [1024, 10], [768, 8], [640, 7], [480, 6],
];
function getResultsGridColumns(): number {
  const w = window.innerWidth;
  for (const [minWidth, columns] of RESULTS_GRID_BREAKPOINTS) {
    if (w >= minWidth) return columns;
  }
  return 5;
}

export default function SearchIsland({ initialQuery = '', initialType = 'all', i18n }: Props) {
  const [isMounted, setIsMounted] = useState(false);
  const [navSlot, setNavSlot]     = useState<HTMLElement | null>(null);
  const [query, setQuery]         = useState(initialQuery);
  const [mediaType, setMediaType] = useState<MediaType>(initialType);
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [status, setStatus]       = useState<SearchStatus>(initialQuery ? 'loading' : 'idle');
  const [missingProviders, setMissingProviders] = useState<string[]>([]);
  const [page, setPage]           = useState(1);
  const [hasMore, setHasMore]     = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortField, setSortField] = useState<'releaseDate' | 'scoreGlobal'>('releaseDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  // Only one of the three toolbar dropdowns (sort / season+year / genre) open
  // at a time — opening one closes whichever else was open.
  const [openDropdown, setOpenDropdown] = useState<'sort' | 'season' | 'genre' | null>(null);
  // Draft values edited inside the panels — only take effect (a real 100-
  // result re-search with these as query parameters, not a client-side
  // narrowing of whatever page was already loaded) once "Aplicar" is
  // pressed, so picking a season/typing a year/checking genres doesn't fire
  // a request per keystroke.
  const [seasonFilter, setSeasonFilter] = useState<SeasonId | ''>('');
  // Defaults to the current year (not blank) — picking just a season without
  // touching the year still filters against something sensible instead of
  // an unset value.
  const [yearFilter, setYearFilter] = useState(() => String(new Date().getFullYear()));
  const [genreFilters, setGenreFilters] = useState<string[]>([]);
  // What the *last applied* search actually used — reflected in the filter
  // button's "has a value" state and re-sent on "Load more"/sort changes.
  const [appliedFilters, setAppliedFilters] = useState<SearchFilters>({});

  // Closes whichever toolbar dropdown is open on any click outside it —
  // these are click-toggled (not hover), so without this they'd only ever
  // close via their own trigger or by opening a different one.
  useEffect(() => {
    if (!openDropdown) return;
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.search-filter-wrap')) setOpenDropdown(null);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [openDropdown]);

  // Starts at the smallest breakpoint's column count (matching SSR/first
  // paint, avoiding a hydration mismatch) and corrects to the real value
  // right after mount.
  const [gridColumns, setGridColumns] = useState(5);
  useEffect(() => {
    const onResize = () => setGridColumns(getResultsGridColumns());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const debounceTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef        = useRef<AbortController | null>(null);
  const searchInputRef            = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsMounted(true);

    // On a full page load the Navbar's #nav-center-slot is already painted
    // before React hydrates, so this resolves on the first check. But on an
    // Astro view-transition navigation to /search, this island can mount
    // before the Navbar has (re)created that node — a one-time getElementById
    // check would miss it forever, leaving the type tabs blank until F5.
    // Poll a few frames until the node shows up.
    let rafId: number;
    let attempts = 0;
    const findSlot = () => {
      const el = document.getElementById('nav-center-slot');
      if (el) {
        setNavSlot(el);
      } else if (attempts++ < 60) {
        rafId = requestAnimationFrame(findSlot);
      }
    };
    findSlot();
    return () => cancelAnimationFrame(rafId);
  }, []);


  // Results come 50 at a time per provider (see lib/search — this used to
  // fetch every page a provider had before showing anything at all, which
  // was the main reason results took so long to appear). pageNum > 1 is a
  // "Load more" click: appends instead of replacing and uses isLoadingMore
  // instead of the full loading state so the existing grid doesn't flash.
  const executeSearch = useCallback(async (searchQuery: string, type: MediaType, pageNum = 1, filters?: SearchFilters) => {
    // A completely empty box still shows something — the type's own top 100
    // by rating — instead of leaving the tab blank until you type (see
    // lib/search/index.ts's topRated; 'all'/'character'/book/comic have no
    // such browse mode and just come back empty, same as before). Season/
    // year/genre filters only ever apply here (a real server-side re-search,
    // not a narrowing of whatever was already fetched) — search()'s own
    // free-text mode doesn't accept them, since TMDB in particular has no
    // way to combine a text query with its filter params.
    const isBrowseMode = searchQuery.length === 0;
    if (!isBrowseMode && searchQuery.length < 2) {
      setStatus('idle');
      setResults([]);
      setHasMore(false);
      return;
    }

    if (pageNum === 1) setStatus('loading');
    else setIsLoadingMore(true);

    // If the exact same type+query+page+filters is already in flight (e.g.
    // debounce and Enter racing each other), ride that request instead of
    // firing another one — this is the only thing avoided, no results are
    // ever reused later.
    const key = `${isBrowseMode ? 'browse' : 'search'}:${type}:${searchQuery.toLowerCase()}:${pageNum}:${JSON.stringify(filters ?? {})}`;
    let promise = inFlightSearches.get(key);
    if (!promise) {
      if (pageNum === 1) abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      promise = (isBrowseMode
        ? topRated(type, abortControllerRef.current.signal, pageNum, filters)
        : search(searchQuery, type, abortControllerRef.current.signal, pageNum)
      ).finally(() => inFlightSearches.delete(key));
      inFlightSearches.set(key, promise);
    }

    try {
      const { results: pageResults, hasMore: more } = await promise;
      setResults(prev => pageNum === 1 ? pageResults : [...prev, ...pageResults]);
      setHasMore(more);
      setPage(pageNum);
      // Browse mode with nothing back (book/comic — no browse API for
      // those) falls back to idle instead of a misleading "no matches".
      setStatus(isBrowseMode && pageNum === 1 && pageResults.length === 0 ? 'idle' : 'done');
      if (pageNum === 1 && !isBrowseMode) {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('type', type);
        currentUrl.searchParams.set('q', searchQuery);
        // Preserves Astro ClientRouter's own state object on this entry
        // instead of nulling it out — see profile.astro's switchTab() for
        // the full explanation of why a null state breaks browser Back.
        history.replaceState(history.state, '', currentUrl.toString());
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort) return;
      if (isBrowseMode) {
        // A background nicety, not something the user explicitly asked
        // for — falls back to idle instead of surfacing a missing-API-key
        // prompt for a query the user never typed.
        setStatus('idle');
        return;
      }
      if (error instanceof MissingApiKeyError) {
        setMissingProviders(error.providers);
        setStatus('missing-keys');
      } else {
        setStatus('error');
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, []);

  const handleLoadMore = () => {
    if (isLoadingMore || !hasMore) return;
    executeSearch(query, mediaType, page + 1, appliedFilters);
  };

  // Skips the very first persist-effect run — its closure still holds this
  // render's pre-restore values, since the setState calls below haven't
  // triggered a re-render yet. The restored values persist fine on the next
  // run once one of them actually changes.
  const skipNextPersistRef = useRef(true);

  useEffect(() => {
    const urlParams = getUrlSearchParams();
    if (urlParams) {
      setQuery(urlParams.query);
      setMediaType(urlParams.mediaType);

      // Quick search's "Ver todos" already ran this exact query+type and
      // stashes its results here before navigating (same key this component
      // persists its own state to) — reuse them instead of re-fetching from
      // scratch and losing the seconds that first fetch already cost.
      const handoff = loadPersistedSearchState();
      if (handoff && handoff.query === urlParams.query && handoff.mediaType === urlParams.mediaType) {
        setResults(handoff.results);
        setStatus(handoff.status === 'loading' ? (handoff.results.length ? 'done' : 'idle') : handoff.status);
        setPage(handoff.page);
        setHasMore(handoff.hasMore);
        setSortField(handoff.sortField);
        setSortDirection(handoff.sortDirection);
      } else {
        executeSearch(urlParams.query, urlParams.mediaType);
      }
    } else if (initialQuery) {
      executeSearch(initialQuery, initialType);
    } else {
      const saved = loadPersistedSearchState();
      if (saved) {
        setQuery(saved.query);
        setMediaType(saved.mediaType);
        setResults(saved.results);
        // A save mid-fetch (navigated away before it settled) has no request
        // to resume — fall back to whatever the results array already shows.
        setStatus(saved.status === 'loading' ? (saved.results.length ? 'done' : 'idle') : saved.status);
        setPage(saved.page);
        setHasMore(saved.hasMore);
        setSortField(saved.sortField);
        setSortDirection(saved.sortDirection);
        const url = new URL(window.location.href);
        url.searchParams.set('type', saved.mediaType);
        url.searchParams.set('q', saved.query);
        history.replaceState(history.state, '', url.toString());
      }
    }
    return () => {
      abortControllerRef.current?.abort();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_KEYS.searchState, JSON.stringify({
        query, mediaType, results, status, page, hasMore, sortField, sortDirection,
      }));
    } catch {
      // sessionStorage unavailable (private mode, quota) — search still works, just won't survive a round trip.
    }
  }, [query, mediaType, results, status, page, hasMore, sortField, sortDirection]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => executeSearch(value, mediaType), 400);
  };

  const handleMediaTypeChange = (selectedType: MediaType) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setMediaType(selectedType);
    setQuery('');
    setResults([]);
    setHasMore(false);
    setPage(1);
    // A genre/season picked for one type's own catalog rarely means anything
    // for a different type (a movie genre list isn't an anime genre list) —
    // clean slate per tab, same as query/results already reset above.
    setSeasonFilter('');
    setYearFilter(String(new Date().getFullYear()));
    setGenreFilters([]);
    setAppliedFilters({});
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('type', selectedType);
    currentUrl.searchParams.delete('q');
    // See executeSearch's replaceState above for why history.state (not
    // null) has to be passed through here.
    history.replaceState(history.state, '', currentUrl.toString());
    // Empty query -> browse mode (top 100 by rating for this type) instead
    // of just idling on a blank tab. executeSearch's own abort() at
    // pageNum===1 replaces the manual abortControllerRef.abort() this used
    // to do here directly.
    executeSearch('', selectedType);
  };

  // Todos' per-type "Ver todo" — same idea as quick search's own "Ver
  // todos" (QuickSearchOverlay.tsx): switches to that type's tab with the
  // same query, reusing the results this component already fetched (the
  // 'all' search already returns every matching type's full list — the
  // one-row cap on Todos is a display-only slice, not a smaller fetch) so
  // there's no redundant re-fetch. No sessionStorage handoff needed like
  // the quick-search version — this stays on the very same component/page.
  const handleViewAllType = (type: MediaType, typeResults: SearchResult[]) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    abortControllerRef.current?.abort();
    setMediaType(type);
    setResults(typeResults);
    setHasMore(hasMore);
    setPage(1);
    setStatus('done');
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('type', type);
    currentUrl.searchParams.set('q', query);
    history.replaceState(history.state, '', currentUrl.toString());
  };

  const handleSearchSubmit = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (query.length >= 2) executeSearch(query, mediaType);
  };

  const toggleSort = (field: 'releaseDate' | 'scoreGlobal') => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc'); // Por defecto descendente (más nuevo o mejor nota primero)
    }
  };

  // Every filter change re-searches immediately (a fresh 100-result page
  // matching the new criteria, see executeSearch's own comment) instead of
  // needing an extra "Aplicar" step — that means clearing the typed query
  // too, since filtered browsing and free-text search can't combine (TMDB's
  // /discover has no query param at all). Takes explicit override values
  // rather than reading state directly: React state updates aren't visible
  // yet in this same handler, so a just-changed value has to be threaded
  // through by hand instead of read back from seasonFilter/yearFilter/
  // genreFilters.
  const runFilterSearch = (overrides: { season?: SeasonId | ''; year?: string; genres?: string[] }) => {
    const season = overrides.season !== undefined ? overrides.season : seasonFilter;
    const year = overrides.year !== undefined ? overrides.year : yearFilter;
    const genres = overrides.genres !== undefined ? overrides.genres : genreFilters;
    const filters: SearchFilters = {
      year: year ? Number(year) : undefined,
      season: season || undefined,
      genres: genres.length > 0 ? genres : undefined,
    };
    setAppliedFilters(filters);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setQuery('');
    executeSearch('', mediaType, 1, filters);
  };

  const changeSeasonFilter = (season: SeasonId | '') => {
    setSeasonFilter(season);
    runFilterSearch({ season });
  };

  const changeYearFilter = (year: string) => {
    setYearFilter(year);
    runFilterSearch({ year });
  };

  const stepYearFilter = (delta: number) => {
    const base = yearFilter ? Number(yearFilter) : new Date().getFullYear();
    changeYearFilter(String(base + delta));
  };

  const clearFilters = () => {
    setSeasonFilter('');
    setYearFilter(String(new Date().getFullYear()));
    setGenreFilters([]);
    setAppliedFilters({});
    setOpenDropdown(null);
    executeSearch(query, mediaType, 1);
  };

  const toggleGenreFilter = (genre: string) => {
    const next = genreFilters.includes(genre) ? genreFilters.filter(g => g !== genre) : [...genreFilters, genre];
    setGenreFilters(next);
    runFilterSearch({ genres: next });
  };

  // Función para ordenar los resultados en base a los estados
  const sortedResults = [...results].sort((a, b) => {
    if (sortField === 'releaseDate') {
      const aYear = a.releaseYear ?? 0;
      const bYear = b.releaseYear ?? 0;
      if (aYear !== bYear) {
        return sortDirection === 'desc' ? bYear - aYear : aYear - bYear;
      }
      const aMonth = a.releaseMonth ?? 0;
      const bMonth = b.releaseMonth ?? 0;
      if (aMonth !== bMonth) {
        return sortDirection === 'desc' ? bMonth - aMonth : aMonth - bMonth;
      }
      const aDay = a.releaseDay ?? 0;
      const bDay = b.releaseDay ?? 0;
      return sortDirection === 'desc' ? bDay - aDay : aDay - bDay;
    } else {
      const aScore = a.scoreGlobal ?? -1;
      const bScore = b.scoreGlobal ?? -1;
      return sortDirection === 'desc' ? bScore - aScore : aScore - bScore;
    }
  });

  const availableGenres = GENRE_OPTIONS[mediaType] ?? [];

  const activeMediaTypeLabel = i18n.types[mediaType].toLowerCase();

  return (
    <div className="min-h-screen flex flex-col">

      <div className="search-header">

        {/* Tabs de tipo de medio inyectadas mediante React Portal directamente en el centro de la Navbar */}
        {isMounted && navSlot ? (
          createPortal(
            <div className="search-tabs-inner">
              {MEDIA_TYPE_IDS.map(typeId => (
                <button
                  key={typeId}
                  onClick={() => handleMediaTypeChange(typeId)}
                  className={`search-tab${mediaType === typeId ? ' active' : ''}`}
                >
                  {TAB_ICONS[typeId]}
                  {getT().search?.types?.[typeId] || i18n.types[typeId]}
                </button>
              ))}
            </div>,
            navSlot
          )
        ) : (
          // Contenedor de reserva/carga
          null
        )}


        {/* Barra de búsqueda */}
        <div className="search-bar-row" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="search-input-wrap" style={{ flexGrow: 1 }}>
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={event => handleQueryChange(event.target.value)}
              onKeyDown={event => event.key === 'Enter' && handleSearchSubmit()}
              placeholder={interpolateTemplate(i18n.placeholder, { type: activeMediaTypeLabel })}
              autoFocus
              className="search-input"
            />
          </div>

          <button
            onClick={handleSearchSubmit}
            className={`search-action-btn${status === 'loading' ? ' loading' : ''}`}
            title={i18n.title}
          >
            {status === 'loading' ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/>
              </svg>
            )}
          </button>

          {/* Barra de filtros: orden, temporada+año y género — cada uno un
              cuadrado que despliega su propio panel debajo. */}
          {isMounted && (
            <div className="search-toolbar">
              {/* Ordenar: un único cuadrado, Fecha y Nota lado a lado en el panel */}
              <div className="search-filter-wrap">
                <button
                  type="button"
                  onClick={() => setOpenDropdown(openDropdown === 'sort' ? null : 'sort')}
                  className={`search-filter-btn${openDropdown === 'sort' ? ' active' : ''}`}
                  title={i18n.sort_date}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M6 12h12M10 18h4"/>
                  </svg>
                </button>
                {openDropdown === 'sort' && (
                  <div className="search-filter-panel search-filter-panel--row">
                    <button
                      type="button"
                      onClick={() => toggleSort('releaseDate')}
                      className={`search-sort-btn${sortField === 'releaseDate' ? ' active' : ''}`}
                      title={i18n.sort_date}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                        </svg>
                        {sortField === 'releaseDate' ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            {sortDirection === 'desc' ? <polyline points="6 9 12 15 18 9"/> : <polyline points="18 15 12 9 6 15"/>}
                          </svg>
                        ) : (
                          <span style={{ width: '10px' }} />
                        )}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleSort('scoreGlobal')}
                      className={`search-sort-btn${sortField === 'scoreGlobal' ? ' active' : ''}`}
                      title={i18n.sort_rating}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                        {sortField === 'scoreGlobal' ? (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            {sortDirection === 'desc' ? <polyline points="6 9 12 15 18 9"/> : <polyline points="18 15 12 9 6 15"/>}
                          </svg>
                        ) : (
                          <span style={{ width: '10px' }} />
                        )}
                      </div>
                    </button>
                  </div>
                )}
              </div>

              {/* Temporada (trimestre) + año — un select y el año a su derecha */}
              <div className="search-filter-wrap">
                <button
                  type="button"
                  onClick={() => setOpenDropdown(openDropdown === 'season' ? null : 'season')}
                  className={`search-filter-btn${openDropdown === 'season' ? ' active' : ''}${appliedFilters.season || appliedFilters.year ? ' has-value' : ''}`}
                  title={i18n.filter_season_year}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                </button>
                {openDropdown === 'season' && (
                  <div className="search-filter-panel">
                    <div className="search-filter-panel--row">
                      <select
                        className="search-filter-select"
                        value={seasonFilter}
                        onChange={e => changeSeasonFilter(e.target.value as SeasonId | '')}
                      >
                        <option value="">{i18n.filter_all}</option>
                        {SEASON_ORDER.map(s => (
                          <option key={s} value={s}>{SEASON_LABELS(i18n)[s]}</option>
                        ))}
                      </select>
                      <div className="search-filter-year-group">
                        <button
                          type="button"
                          className="search-filter-year-step"
                          onClick={() => stepYearFilter(-1)}
                          aria-label="-1"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          className="search-filter-year-input"
                          placeholder={String(new Date().getFullYear())}
                          value={yearFilter}
                          onChange={e => setYearFilter(e.target.value)}
                          onBlur={() => changeYearFilter(yearFilter)}
                          onKeyDown={e => e.key === 'Enter' && changeYearFilter(yearFilter)}
                        />
                        <button
                          type="button"
                          className="search-filter-year-step"
                          onClick={() => stepYearFilter(1)}
                          aria-label="+1"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        className="search-filter-clear-x"
                        onClick={clearFilters}
                        title={i18n.filter_clear}
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Género — lista con checkboxes, selección múltiple. Solo se
                  ofrece para tipos cuyo proveedor de verdad soporta filtrar
                  por género server-side (ver GENRE_OPTIONS). */}
              {availableGenres.length > 0 && (
                <div className="search-filter-wrap">
                  <button
                    type="button"
                    onClick={() => setOpenDropdown(openDropdown === 'genre' ? null : 'genre')}
                    className={`search-filter-btn${openDropdown === 'genre' ? ' active' : ''}${appliedFilters.genres?.length ? ' has-value' : ''}`}
                    title={i18n.filter_genre}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.24L4 3a1 1 0 0 0-1 1l.24 5.59a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.35-4.35a2 2 0 0 0 0-2.82Z"/>
                      <circle cx="7.5" cy="7.5" r="1"/>
                    </svg>
                  </button>
                  {openDropdown === 'genre' && (
                    <div className="search-filter-panel search-filter-panel--genres">
                      <ul className="search-filter-genre-list">
                        {availableGenres.map(g => (
                          <li key={g}>
                            <label className="search-filter-genre-item">
                              <input
                                type="checkbox"
                                checked={genreFilters.includes(g)}
                                onChange={() => toggleGenreFilter(g)}
                              />
                              {g}
                            </label>
                          </li>
                        ))}
                      </ul>
                      {(genreFilters.length > 0) && (
                        <div className="search-filter-panel-actions">
                          <button type="button" className="search-filter-clear" onClick={clearFilters}>
                            {i18n.filter_clear}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>


      </div>

      {/* Zona de resultados */}
      <div className="results-zone flex-1">
        {status === 'idle' && (
          <div className="search-idle">
            <p className="search-idle-label">
              {interpolateTemplate(i18n.idle_label, { type: activeMediaTypeLabel })}
            </p>
            <p className="search-idle-hint">{i18n.idle_hint}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="results-empty results-error">{i18n.error}</div>
        )}

        {status === 'missing-keys' && (
          <div className="results-empty results-missing-keys">
            <p>{i18n.missing_keys}</p>
            <a
              href={missingProviders.length === 1
                ? PROVIDER_SETTINGS_LINK[missingProviders[0]] ?? '/settings?tab=environment'
                : '/settings?tab=environment'}
              className="search-missing-keys-btn"
            >
              {i18n.missing_keys_cta}
            </a>
          </div>
        )}

        {status === 'done' && results.length === 0 && (
          <div className="results-empty">
            {interpolateTemplate(i18n.no_results, { q: query })}
          </div>
        )}

        {sortedResults.length > 0 && (() => {
          const seen = new Set<string>();
          const deduped = sortedResults.filter(result => {
            if (seen.has(result.externalId)) return false;
            seen.add(result.externalId);
            return true;
          });

          // Todos mixes every type into the same relevance-agnostic sort,
          // which read as one undifferentiated pile — grouped by type
          // instead (each group keeping the same date/score sort), same
          // as a single-type tab shows on its own.
          if (mediaType !== 'all') {
            return (
              <div className="results-grid animate-fade-in">
                {deduped.map(result => <MediaCard key={result.externalId} result={result} />)}
              </div>
            );
          }

          const byType = new Map<string, SearchResult[]>();
          for (const result of deduped) {
            const list = byType.get(result.type) ?? [];
            list.push(result);
            byType.set(result.type, list);
          }
          const typeOrder = (SEARCH_TAB_TYPES as readonly string[]).filter(t => t !== 'all' && t !== 'character' && t !== 'staff');

          return (
            <div className="results-by-type animate-fade-in">
              {typeOrder.filter(t => byType.has(t)).map(t => (
                <div className="results-type-section" key={t}>
                  <h3 className="results-type-title">
                    {i18n.types[t as keyof typeof i18n.types]}
                    <button
                      type="button"
                      className="results-type-view-all"
                      onClick={() => handleViewAllType(t as MediaType, byType.get(t)!)}
                    >
                      {i18n.view_all}
                    </button>
                  </h3>
                  <div className="results-grid">
                    {byType.get(t)!.slice(0, gridColumns).map(result => <MediaCard key={result.externalId} result={result} />)}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Providers cap a page at ~50 results and only ever report hasMore
            when a full page came back — but the handoff from quick search's
            "Ver todos" (see goToViewAll in QuickSearchOverlay.tsx) reuses a
            single all-types-aggregate hasMore for every individual type
            section, which can read true even for a type with only a
            handful of matches. Gating on the actual count caught here
            regardless of why hasMore might be stale. */}
        {status === 'done' && hasMore && results.length >= SEARCH_PAGE_SIZE && (
          <div className="search-load-more-row">
            <button
              type="button"
              className="search-load-more-btn"
              onClick={handleLoadMore}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? <span className="spinner spinner--sm" /> : i18n.load_more}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MediaCard({ result }: { result: SearchResult }) {
  const hasDetail = (DETAIL_SUPPORTED_TYPES as readonly string[]).includes(result.type);
  // Landscape "covers" (rare provider mixups — a banner/splash image
  // instead of a real poster) look bad even center-cropped, so those fall
  // back to the placeholder instead. This used to be checked via a
  // separate, invisible new Image() probe fired eagerly (not lazily) for
  // every single result on mount — meaning every cover was fetched twice
  // (once by the probe, once by the real <img>), and the whole card
  // returned null while its own probe was pending, unmounting/remounting
  // grid items as each of up to 50 probes resolved at its own pace. That's
  // what made the grid look like it kept reflowing into different sizes.
  // Checking the real (already lazy-loaded) <img>'s own onLoad instead
  // needs no extra request and never removes the card itself from the
  // grid — only its cover swaps to the placeholder, and only once actually
  // known to be landscape.
  const [isLandscape, setIsLandscape] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  function handleCoverLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (img.naturalWidth > img.naturalHeight) setIsLandscape(true);
  }

  // prefetchMediaData (mediaService.ts) is local-only now — reads the entry
  // from media_catalog if it's already there, never calls out to AniList/
  // IGDB/TMDB/OpenLibrary/ComicVine, so firing it on every hover has no
  // external-request cost to worry about.
  function handleMouseEnter() {
    if (hasDetail && result.type !== 'character' && result.type !== 'staff') prefetchMediaData(result.externalId);
  }

  async function handleClick() {
    if (hasDetail) {
      const { navigate } = await import('astro:transitions/client');
      if (result.type === 'character') {
        const rawId = result.externalId.replace('character:', '');
        navigate(`/character?id=${rawId}`);
        return;
      }
      if (result.type === 'staff') {
        // externalId is already "person:a<id>" (see searchStaff, lib/search/index.ts) —
        // the same id scheme quick search's staff results use, resolved by
        // the existing /author page (fetchLiveAniListStaff).
        navigate(`/author?id=${result.externalId}`);
        return;
      }
      if (result.authorNames?.length) {
        sessionStorage.setItem(`book_authors:${result.externalId}`, JSON.stringify(result.authorNames));
      }
      navigate(`/media?id=${result.externalId}`);
    }
  }

  return (
    <div
      className={`group flex flex-col card-cursor${hasDetail ? ' card-clickable' : ''}`}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      role={hasDetail ? 'button' : undefined}
      tabIndex={hasDetail ? 0 : undefined}
      onKeyDown={hasDetail ? (e) => e.key === 'Enter' && handleClick() : undefined}
    >
      <div className="card-media-base mb-1.5">
        {result.coverUrl && !loadFailed && !isLandscape ? (
          <img
            src={result.coverUrl}
            alt={result.titleMain}
            className="card-media-img"
            loading="lazy"
            onLoad={handleCoverLoad}
            onError={() => setLoadFailed(true)}
          />
        ) : (
          <div className="card-media-placeholder" />
        )}
        {result.scoreGlobal !== null && (
          <div className="card-rating-badge">{formatAverageScore(result.scoreGlobal, getActiveRatingSystem())}</div>
        )}
      </div>
      <p className="card-title">{result.titleMain}</p>
      {result.releaseYear && (
        <p className="card-year">{result.releaseYear}</p>
      )}
    </div>
  );
}
