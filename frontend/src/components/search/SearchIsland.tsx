import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { search, type MediaType, type SearchResult, MissingApiKeyError } from '../../lib/search/index';
import { prefetchMediaData } from '../../lib/media/mediaService';
import { getT } from '../../i18n/client';
import type { Translations } from '../../i18n/index';
import { IconAll, IconAnime, IconManga, IconNovel, IconGame, IconVNovel, IconMovie, IconSeries, IconBook, IconComic, IconCharacter } from '../local/ui/icons';
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
};

const MEDIA_TYPE_IDS = SEARCH_TAB_TYPES as unknown as MediaType[];

type SearchStatus = 'idle' | 'loading' | 'done' | 'error' | 'missing-keys';

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
  const executeSearch = useCallback(async (searchQuery: string, type: MediaType, pageNum = 1) => {
    if (searchQuery.length < 2) {
      setStatus('idle');
      setResults([]);
      setHasMore(false);
      return;
    }

    if (pageNum === 1) setStatus('loading');
    else setIsLoadingMore(true);

    // If the exact same type+query+page is already in flight (e.g. debounce
    // and Enter racing each other), ride that request instead of firing
    // another one — this is the only thing avoided, no results are ever
    // reused later.
    const key = `${type}:${searchQuery.toLowerCase()}:${pageNum}`;
    let promise = inFlightSearches.get(key);
    if (!promise) {
      if (pageNum === 1) abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      promise = search(searchQuery, type, abortControllerRef.current.signal, pageNum)
        .finally(() => inFlightSearches.delete(key));
      inFlightSearches.set(key, promise);
    }

    try {
      const { results: pageResults, hasMore: more } = await promise;
      setResults(prev => pageNum === 1 ? pageResults : [...prev, ...pageResults]);
      setHasMore(more);
      setPage(pageNum);
      setStatus('done');
      if (pageNum === 1) {
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
    executeSearch(query, mediaType, page + 1);
  };

  // Skips the very first persist-effect run — its closure still holds this
  // render's pre-restore values, since the setState calls below haven't
  // triggered a re-render yet. The restored values persist fine on the next
  // run once one of them actually changes.
  const skipNextPersistRef = useRef(true);

  useEffect(() => {
    if (initialQuery) {
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
    abortControllerRef.current?.abort();
    setMediaType(selectedType);
    setQuery('');
    setResults([]);
    setHasMore(false);
    setPage(1);
    setStatus('idle');
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('type', selectedType);
    currentUrl.searchParams.delete('q');
    // See executeSearch's replaceState above for why history.state (not
    // null) has to be passed through here.
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
      return sortDirection === 'desc' ? bDay - aDay : aDay - aDay;
    } else {
      const aScore = a.scoreGlobal ?? -1;
      const bScore = b.scoreGlobal ?? -1;
      return sortDirection === 'desc' ? bScore - aScore : aScore - bScore;
    }
  });

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

          {/* Botones de ordenación (solo iconos minimalistas, siempre visibles) */}
          {isMounted && (
            <div className="search-sort-group" style={{ display: 'flex', gap: '0.25rem' }}>
              {/* Ordenar por Fecha */}
              <button
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

              {/* Ordenar por Calificación */}
              <button
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

        {sortedResults.length > 0 && (
          <div className="results-grid animate-fade-in">
            {(() => {
              const seen = new Set();
              return sortedResults
                .filter(result => {
                  if (seen.has(result.externalId)) return false;
                  seen.add(result.externalId);
                  return true;
                })
                .map(result => (
                  <MediaCard key={result.externalId} result={result} />
                ));
            })()}
          </div>
        )}

        {status === 'done' && hasMore && (
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

// Hover-intent delay before prefetching a card's detail data — quickly
// scanning across many results used to fire a prefetch (and for anime/manga
// with a large cast, a burst of AniList character-page requests) per card,
// which could exhaust AniList's rate limit before the user even opened one.
// Cancelled on mouse-leave, so a card the user actually pauses on still
// prefetches exactly as before.
const HOVER_PREFETCH_DELAY_MS = 300;

function MediaCard({ result }: { result: SearchResult }) {
  const hasDetail = (DETAIL_SUPPORTED_TYPES as readonly string[]).includes(result.type);
  const [isValidCover, setIsValidCover] = useState<boolean | null>(result.coverUrl ? null : true);
  // Some providers (OpenLibrary especially — its cover proxy sometimes
  // redirects through archive.org on first request, which can be slow or
  // fail outright in the webview even though the URL is genuinely valid)
  // occasionally fail to actually load the image. The probe below used to
  // treat img.onerror the same as "valid, portrait" and let the real <img>
  // render with the same broken URL anyway — showing a broken-image icon +
  // alt text instead of the placeholder, and (since a broken image's
  // intrinsic box isn't governed by object-fit the same way) breaking the
  // uniform card size the rest of the grid relies on. Tracked separately
  // from isValidCover so a genuinely-failed load always falls back to the
  // placeholder instead of attempting the real <img> at all.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!result.coverUrl) return;
    const img = new Image();
    img.src = result.coverUrl;
    img.onload = () => {
      if (img.naturalWidth > img.naturalHeight) {
        setIsValidCover(false);
      } else {
        setIsValidCover(true);
      }
    };
    img.onerror = () => {
      setLoadFailed(true);
      setIsValidCover(true);
    };
  }, [result.coverUrl]);

  if (isValidCover === false || isValidCover === null) {
    return null;
  }

  function handleMouseEnter() {
    if (hasDetail && result.type !== 'character') prefetchMediaData(result.externalId);
  }

  async function handleClick() {
    if (hasDetail) {
      const { navigate } = await import('astro:transitions/client');
      if (result.type === 'character') {
        const rawId = result.externalId.replace('character:', '');
        navigate(`/character?id=${rawId}`);
        return;
      }
      if (result.authorNames?.length) {
        sessionStorage.setItem(`book_authors:${result.externalId}`, JSON.stringify(result.authorNames));
      }
      if (result.authorKey) {
        sessionStorage.setItem(`book_author_key:${result.externalId}`, result.authorKey);
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
        {result.coverUrl && !loadFailed ? (
          <img
            src={result.coverUrl}
            alt={result.titleMain}
            className="card-media-img"
            loading="lazy"
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
