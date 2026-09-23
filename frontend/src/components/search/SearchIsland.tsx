import { useState, useCallback, useRef, useEffect, useMemo, type ReactElement } from 'react';
import { useHydrated } from '../shared/hooks/useHydrated';
import { createPortal } from 'react-dom';
import { search, topRated, type MediaType, type SearchResult, type SeasonId, type SearchFilters, MissingApiKeyError } from '../../lib/search/index';
import type { ApiSportsDiscipline } from '../../lib/search/providers/apisports';
import { getCachedBrowsePage, setCachedBrowsePage } from '../../lib/search/browse-cache';
import { filterValidAnimeCovers } from '../../lib/search/cover-filter';
import { SearchRequestGuard } from '../../lib/search/search-request-guard';
import { ANILIST_GENRES } from '../../lib/search/providers/anilist';
import { IGDB_GENRES } from '../../lib/search/providers/igdb';
import { TMDB_MOVIE_GENRE_NAMES, TMDB_TV_GENRE_NAMES } from '../../lib/search/providers/tmdb';
import {
  getResultsGridColumns, getUrlSearchParams, loadPersistedSearchState, type PersistedSearchState, type SearchStatus,
} from '../../lib/search/search-island-state';
import { compareByReleaseDate, compareByReleaseDateDesc } from '../../lib/media/mappers/mapper-utils';
import { getT } from '../../i18n/runtime';
import type { Translations } from '../../i18n/index';
import { IconAll, IconAnime, IconManga, IconNovel, IconGame, IconVNovel, IconMovie, IconSeries, IconBook, IconComic, IconEvent, IconCharacter, IconStaff } from '../local/ui/icons';
import { SEARCH_TAB_TYPES, isMediaTypeDisabled } from '../../lib/media/media-types';
import { isUnifySeasonsEnabled } from '../../lib/storage/preferences';
import { STORAGE_KEYS } from '../../lib/storage/storage-keys';
import { useDebouncedCallback } from '../shared/hooks/useDebouncedCallback';
import { interpolate } from '../../lib/shared/text/interpolate';
import { useNavSlot } from '../shared/hooks/useNavSlot';
import { useShortcuts } from '../shared/hooks/useShortcuts';
import { SearchResultCard } from './SearchResultCard';
import { EventDisciplinePicker } from './EventDisciplinePicker';
import { SearchFilterBar, type SearchDropdown, type SearchSortDirection, type SearchSortField } from './SearchFilterBar';

type SearchTranslations = Translations['search'];

// ── Tab icons ────────────────────────────────────────────────────────────────

const TAB_ICONS: Record<MediaType, ReactElement> = {
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
  event:     <IconEvent />,
  character: <IconCharacter />,
  staff:     <IconStaff />,
};

const MEDIA_TYPE_IDS = SEARCH_TAB_TYPES as unknown as MediaType[];

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
  apisports: '/settings?tab=environment&platform=apisports',
};

// In-flight de-duplication (debounce and Enter racing each other) and the
// 10-minute exact-query memo both live in lib/search now (search-memo.ts,
// shared with the quick-search overlay) — this component only owns the
// "which response is current" bookkeeping, via SearchRequestGuard.

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

// The persisted payload includes the full results array (loadPersistedSearchState's
// callers restore it, and quick search's "Ver todos" hands results off through
// the same key), so serialising it on every results change — several times in
// a row during an auto-chained anime fetch — is the expensive part. Writes are
// coalesced behind this delay and flushed on unmount / pagehide instead.
const PERSIST_DEBOUNCE_MS = 300;

interface Props {
  initialQuery?: string;
  initialType?: MediaType;
  i18n: SearchTranslations;
}

export default function SearchIsland({ initialQuery = '', initialType = 'all', i18n }: Props) {
  const isMounted = useHydrated();
  const navSlot = useNavSlot();
  const [query, setQuery]         = useState(initialQuery);
  const [mediaType, setMediaType] = useState<MediaType>(initialType);
  const [eventDiscipline, setEventDiscipline] = useState<ApiSportsDiscipline | ''>('');
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [status, setStatus]       = useState<SearchStatus>(initialQuery ? 'loading' : 'idle');
  const [missingProviders, setMissingProviders] = useState<string[]>([]);
  const [page, setPage]           = useState(1);
  const [hasMore, setHasMore]     = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sortField, setSortField] = useState<SearchSortField>('releaseDate');
  const [sortDirection, setSortDirection] = useState<SearchSortDirection>('desc');
  // Only one of the three toolbar dropdowns (sort / season+year / genre) open
  // at a time — opening one closes whichever else was open.
  const [openDropdown, setOpenDropdown] = useState<SearchDropdown | null>(null);
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  useEffect(() => {
    const onResize = () => setGridColumns(getResultsGridColumns());
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // One AbortController + sequence id per search — a response is only ever
  // applied while its sequence is still the latest, so an older request
  // that outlives a newer (e.g. memo-instant) one can't overwrite it. The
  // local-catalog preview of a search is likewise only shown until that
  // same search's full page has been applied (settledSeqRef).
  const guardRef                  = useRef(new SearchRequestGuard());
  const settledSeqRef             = useRef(0);
  const previewSeqRef             = useRef(0);
  const searchInputRef            = useRef<HTMLInputElement>(null);

  // mod+F jumps to the search box instead of opening the WebView's find bar.
  useShortcuts('page', [{
    id: 'search.focus_input',
    keys: 'mod+f',
    description: 'shortcuts.search_focus_input',
    handler: () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
  }]);


  // Results come 50 at a time per provider (see lib/search — this used to
  // fetch every page a provider had before showing anything at all, which
  // was the main reason results took so long to appear). pageNum > 1 is a
  // "Load more" click: appends instead of replacing and uses isLoadingMore
  // instead of the full loading state so the existing grid doesn't flash.
  //
  // autoChain is only ever set by this function calling itself (see the
  // bottom of the try block) — a cover-filtered anime page (filterValidAnimeCovers)
  // can come back much sparser than a normal one, so instead of leaving the
  // grid looking broken until the user manually clicks "Load more" several
  // times in a row, this keeps fetching subsequent pages behind the scenes
  // until enough survive filtering. Costs no AniList requests beyond what
  // those manual clicks would eventually spend anyway — just spends them
  // upfront, automatically, capped so a genre with almost no valid covers
  // can't spiral into fetching every page it has.
  const executeSearch = useCallback(async (
    searchQuery: string, type: MediaType, pageNum = 1, filters?: SearchFilters,
    autoChain?: { count: number; accumulated: number },
    discipline: ApiSportsDiscipline | '' = '',
  ) => {
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

    if (pageNum === 1) {
      setStatus('loading');
      setErrorMessage(null);
    } else {
      setIsLoadingMore(true);
    }

    // A fresh page-1 search cancels whatever was running and takes a new
    // sequence; "Load more" and an auto-chained page belong to the current
    // search and reuse its signal/sequence instead.
    const guard = guardRef.current;
    const { seq, signal } = pageNum === 1 && !autoChain ? guard.begin() : guard.current();

    // Browse-mode cache key (session-scoped, see browse-cache.ts).
    const key = `browse:${type}:${pageNum}:${JSON.stringify(filters ?? {})}:${type === 'event' ? `${discipline}:${isUnifySeasonsEnabled()}` : ''}`;

    try {
      let pageResults: SearchResult[];
      let more: boolean;

      // Browse mode's top-rated list barely changes minute to minute — a
      // cache hit skips the network entirely instead of re-fetching the
      // same page from AniList/IGDB/TMDB every time this tab/page is
      // revisited within the session.
      const cached = isBrowseMode ? getCachedBrowsePage(key) : null;
      if (cached) {
        pageResults = cached.results;
        more = cached.hasMore;
      } else if (isBrowseMode) {
        const fetched = await topRated(type, signal, pageNum, filters);
        pageResults = fetched.results;
        more = fetched.hasMore;
        setCachedBrowsePage(key, fetched);
      } else {
        // Local catalog rows render the moment they're read (one IPC call),
        // before any provider answers — but only for a page-1 search, and
        // only until that search's full page lands (or a newer one starts).
        const onLocalResults = pageNum === 1 && !autoChain
          ? (local: SearchResult[]) => {
            if (!guard.isCurrent(seq) || settledSeqRef.current === seq) return;
            const apply = (rows: SearchResult[]) => {
              if (!guard.isCurrent(seq) || settledSeqRef.current === seq || rows.length === 0) return;
              // The first preview of a search replaces the previous
              // search's grid; later ones (other types of an "all"
              // search) merge in without touching what's already shown.
              const isFirstPreview = previewSeqRef.current !== seq;
              previewSeqRef.current = seq;
              setResults(prev => {
                if (isFirstPreview) return rows;
                const seen = new Set(prev.map(r => r.externalId));
                return [...prev, ...rows.filter(r => !seen.has(r.externalId))];
              });
            };
            if (type === 'anime') filterValidAnimeCovers(local).then(apply);
            else apply(local);
          }
          : undefined;
        const fetched = await search(searchQuery, type, signal, pageNum, discipline || null, { onLocalResults });
        pageResults = fetched.results;
        more = fetched.hasMore;
      }

      if (!guard.isCurrent(seq)) return;

      // No cover, or a landscape ("horizontal") one — same idea as
      // openlibrary.ts's book filter, just needing an actual image probe
      // since AniList exposes no width/height field to check server-side.
      const filteredResults = type === 'anime' ? await filterValidAnimeCovers(pageResults) : pageResults;
      if (!guard.isCurrent(seq)) return;
      const totalSoFar = (autoChain?.accumulated ?? 0) + filteredResults.length;

      if (pageNum === 1 && !autoChain) settledSeqRef.current = seq;
      setResults(prev => (!autoChain && pageNum === 1) ? filteredResults : [...prev, ...filteredResults]);
      setHasMore(more);
      setPage(pageNum);
      // Browse mode with nothing back (book/comic — no browse API for
      // those) falls back to idle instead of a misleading "no matches".
      setStatus(isBrowseMode && pageNum === 1 && totalSoFar === 0 ? 'idle' : 'done');
      if (pageNum === 1 && !isBrowseMode && !autoChain) {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('type', type);
        currentUrl.searchParams.set('q', searchQuery);
        if (type === 'event' && discipline) currentUrl.searchParams.set('discipline', discipline);
        else currentUrl.searchParams.delete('discipline');
        // Preserves Astro ClientRouter's own state object on this entry
        // instead of nulling it out — see profile.astro's switchTab() for
        // the full explanation of why a null state breaks browser Back.
        history.replaceState(history.state, '', currentUrl.toString());
      }

      const MIN_RESULTS_AFTER_COVER_FILTER = 30;
      const MAX_AUTO_CHAINED_PAGES = 4;
      const chainCount = autoChain?.count ?? 0;
      if (type === 'anime' && more && totalSoFar < MIN_RESULTS_AFTER_COVER_FILTER && chainCount < MAX_AUTO_CHAINED_PAGES) {
        executeSearch(searchQuery, type, pageNum + 1, filters, { count: chainCount + 1, accumulated: totalSoFar }, discipline);
      }
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (isAbort || !guard.isCurrent(seq)) return;
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
        const errorMsg = error instanceof Error ? error.message : String(error);
        setErrorMessage(errorMsg || null);
        setStatus('error');
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, []);

  // Any handler that changes what should be searched next (tab switch,
  // filter change, submitting mid-debounce, ...) cancels a pending debounced
  // search instead of letting a now-stale query fire after the fact.
  const [debouncedSearch, cancelDebouncedSearch] = useDebouncedCallback(
    (value: string) => executeSearch(value, mediaType, 1, undefined, undefined, eventDiscipline), 400,
  );

  const handleLoadMore = () => {
    if (isLoadingMore || !hasMore) return;
    executeSearch(query, mediaType, page + 1, appliedFilters, undefined, eventDiscipline);
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
      setEventDiscipline(urlParams.eventDiscipline);

      // Quick search's "Ver todos" already ran this exact query+type and
      // stashes its results here before navigating (same key this component
      // persists its own state to) — reuse them instead of re-fetching from
      // scratch and losing the seconds that first fetch already cost.
      const handoff = loadPersistedSearchState();
      if (handoff && handoff.query === urlParams.query && handoff.mediaType === urlParams.mediaType
        && (handoff.eventDiscipline ?? '') === urlParams.eventDiscipline
        && (urlParams.mediaType !== 'event' || handoff.eventSeasonsUnified === isUnifySeasonsEnabled())) {
        setResults(handoff.results);
        setStatus(handoff.status === 'loading' ? (handoff.results.length ? 'done' : 'idle') : handoff.status);
        setPage(handoff.page);
        setHasMore(handoff.hasMore);
        setSortField(handoff.sortField);
        setSortDirection(handoff.sortDirection);
      } else {
        executeSearch(urlParams.query, urlParams.mediaType, 1, undefined, undefined, urlParams.eventDiscipline);
      }
    } else if (initialQuery) {
      executeSearch(initialQuery, initialType);
    } else {
      const saved = loadPersistedSearchState();
      if (saved) {
        setQuery(saved.query);
        setMediaType(saved.mediaType);
        const savedDiscipline = saved.eventDiscipline === 'football' || saved.eventDiscipline === 'basketball' ? saved.eventDiscipline : '';
        const groupingChanged = saved.mediaType === 'event' && saved.eventSeasonsUnified !== isUnifySeasonsEnabled();
        setEventDiscipline(savedDiscipline);
        setResults(groupingChanged ? [] : saved.results);
        // A save mid-fetch (navigated away before it settled) has no request
        // to resume — fall back to whatever the results array already shows.
        setStatus(groupingChanged ? 'loading' : saved.status === 'loading' ? (saved.results.length ? 'done' : 'idle') : saved.status);
        setPage(saved.page);
        setHasMore(saved.hasMore);
        setSortField(saved.sortField);
        setSortDirection(saved.sortDirection);
        const url = new URL(window.location.href);
        url.searchParams.set('type', saved.mediaType);
        url.searchParams.set('q', saved.query);
        if (saved.mediaType === 'event' && savedDiscipline) url.searchParams.set('discipline', savedDiscipline);
        else url.searchParams.delete('discipline');
        history.replaceState(history.state, '', url.toString());
        if (groupingChanged) executeSearch(saved.query, saved.mediaType, 1, undefined, undefined, savedDiscipline);
      }
    }
    const guard = guardRef.current;
    return () => {
      guard.cancel();
      cancelDebouncedSearch();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Latest not-yet-written snapshot + its pending timer. The object (not its
  // JSON) is held so the serialisation itself only happens once per flush.
  const pendingPersistRef = useRef<PersistedSearchState | null>(null);
  const persistTimerRef = useRef<number | null>(null);

  const flushPersist = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const pending = pendingPersistRef.current;
    if (!pending) return;
    pendingPersistRef.current = null;
    try {
      sessionStorage.setItem(STORAGE_KEYS.searchState, JSON.stringify(pending));
    } catch {
      // sessionStorage unavailable (private mode, quota) — search still works, just won't survive a round trip.
    }
  }, []);

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    pendingPersistRef.current = {
      query, mediaType, eventDiscipline, eventSeasonsUnified: isUnifySeasonsEnabled(), results, status, page, hasMore, sortField, sortDirection,
    };
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(flushPersist, PERSIST_DEBOUNCE_MS);
  }, [query, mediaType, eventDiscipline, results, status, page, hasMore, sortField, sortDirection, flushPersist]);

  // Whatever is still pending when the island goes away (ClientRouter swap,
  // reload, tab close) is written immediately, so a navigation right after
  // the last change restores exactly what the synchronous write used to.
  useEffect(() => {
    window.addEventListener('pagehide', flushPersist);
    return () => {
      window.removeEventListener('pagehide', flushPersist);
      flushPersist();
    };
  }, [flushPersist]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    debouncedSearch(value);
  };

  const handleMediaTypeChange = (selectedType: MediaType) => {
    cancelDebouncedSearch();
    setMediaType(selectedType);
    setEventDiscipline('');
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
    currentUrl.searchParams.delete('discipline');
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
    cancelDebouncedSearch();
    guardRef.current.cancel();
    setMediaType(type);
    setEventDiscipline('');
    setResults(typeResults);
    setHasMore(hasMore);
    setPage(1);
    setStatus('done');
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('type', type);
    currentUrl.searchParams.set('q', query);
    currentUrl.searchParams.delete('discipline');
    history.replaceState(history.state, '', currentUrl.toString());
  };

  const handleSearchSubmit = () => {
    cancelDebouncedSearch();
    if (query.length >= 2) executeSearch(query, mediaType, 1, undefined, undefined, eventDiscipline);
  };

  const handleEventDisciplineChange = (value: string) => {
    const discipline: ApiSportsDiscipline | '' = value === 'football' || value === 'basketball' ? value : '';
    cancelDebouncedSearch();
    setEventDiscipline(discipline);
    const currentUrl = new URL(window.location.href);
    if (discipline) currentUrl.searchParams.set('discipline', discipline);
    else currentUrl.searchParams.delete('discipline');
    history.replaceState(history.state, '', currentUrl.toString());
    if (query.trim().length >= 2) executeSearch(query, 'event', 1, undefined, undefined, discipline);
    else {
      setResults([]);
      setStatus('idle');
      setHasMore(false);
    }
  };

  const toggleSort = (field: SearchSortField) => {
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
    cancelDebouncedSearch();
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
    executeSearch(query, mediaType, 1, undefined, undefined, eventDiscipline);
  };

  const toggleGenreFilter = useCallback((genre: string) => {
    setGenreFilters(prev => {
      const next = prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre];
      runFilterSearch({ genres: next });
      return next;
    });
  }, []);

  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      if (sortField === 'releaseDate') {
        const key = (r: SearchResult) => ({
          release_year: r.releaseYear, release_month: r.releaseMonth, release_day: r.releaseDay, id: r.externalId,
        });
        return sortDirection === 'desc'
          ? compareByReleaseDateDesc(key(a), key(b))
          : compareByReleaseDate(key(a), key(b));
      } else {
        const aScore = a.scoreGlobal ?? -1;
        const bScore = b.scoreGlobal ?? -1;
        return sortDirection === 'desc' ? bScore - aScore : aScore - bScore;
      }
    });
  }, [results, sortField, sortDirection]);

  const availableGenres = useMemo(() => GENRE_OPTIONS[mediaType] ?? [], [mediaType]);

  const activeMediaTypeLabel = useMemo(() => i18n.types[mediaType].toLowerCase(), [i18n, mediaType]);

  const deduped = useMemo(() => {
    const seen = new Set<string>();
    return sortedResults.filter(result => {
      if (seen.has(result.externalId)) return false;
      seen.add(result.externalId);
      return true;
    });
  }, [sortedResults]);

  const byType = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    for (const result of deduped) {
      const list = map.get(result.type) ?? [];
      list.push(result);
      map.set(result.type, list);
    }
    return map;
  }, [deduped]);

  const typeOrder = useMemo(() => (SEARCH_TAB_TYPES as readonly string[]).filter(t => t !== 'all' && t !== 'character' && t !== 'staff'), []);

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
                  type="button"
                  disabled={isMediaTypeDisabled(typeId)}
                  onClick={() => handleMediaTypeChange(typeId)}
                  className={`search-tab${mediaType === typeId ? ' active' : ''}`}
                >
                  <span className="search-tab-icon">{TAB_ICONS[typeId]}</span>
                  <span className="search-tab-label">{getT().search?.types?.[typeId] || i18n.types[typeId]}</span>
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
              placeholder={interpolate(i18n.placeholder, { type: activeMediaTypeLabel })}
              autoFocus
              className="search-input"
            />
          </div>

          {mediaType === 'event' && (
            <EventDisciplinePicker eventDiscipline={eventDiscipline} onChange={handleEventDisciplineChange} i18n={i18n} />
          )}

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
            <SearchFilterBar
              i18n={i18n}
              openDropdown={openDropdown}
              onOpenDropdownChange={setOpenDropdown}
              sortField={sortField}
              sortDirection={sortDirection}
              onToggleSort={toggleSort}
              seasonFilter={seasonFilter}
              onSeasonChange={changeSeasonFilter}
              yearFilter={yearFilter}
              onYearDraftChange={setYearFilter}
              onYearCommit={changeYearFilter}
              onYearStep={stepYearFilter}
              genreFilters={genreFilters}
              availableGenres={availableGenres}
              onToggleGenre={toggleGenreFilter}
              appliedFilters={appliedFilters}
              onClearFilters={clearFilters}
            />
          )}
        </div>


      </div>

      {/* Zona de resultados */}
      <div className="results-zone flex-1">
        {status === 'idle' && (
          <div className="search-idle">
            <p className="search-idle-label">
              {interpolate(i18n.idle_label, { type: activeMediaTypeLabel })}
            </p>
            <p className="search-idle-hint">{i18n.idle_hint}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="results-empty results-error">
            <p>{i18n.error}</p>
            {errorMessage && <p className="results-error-reason">{errorMessage}</p>}
          </div>
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
            {interpolate(i18n.no_results, { q: query })}
          </div>
        )}

        {deduped.length > 0 && (
          mediaType !== 'all' ? (
            <div className="results-grid animate-fade-in">
              {deduped.map(result => <SearchResultCard key={result.externalId} result={result} />)}
            </div>
          ) : (
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
                    {byType.get(t)!.slice(0, gridColumns).map(result => <SearchResultCard key={result.externalId} result={result} />)}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

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
