import { useState, useCallback, useRef, useEffect } from 'react';
import { search, type MediaType, type SearchResult } from '../../lib/search/index';
import { prefetchMediaData } from '../../lib/media/mediaService';
import type { Translations } from '../../i18n/index';
import { IconAll, IconAnime, IconManga, IconNovel, IconGame, IconVNovel, IconMovie, IconSeries, IconBook, IconCharacter } from '../local/ui/icons';
import { SEARCH_TAB_TYPES, DETAIL_SUPPORTED_TYPES } from '../../lib/constants/media';

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
  character: <IconCharacter />,
};

const MEDIA_TYPE_IDS = SEARCH_TAB_TYPES as unknown as MediaType[];

type SearchStatus = 'idle' | 'loading' | 'done' | 'error';

// ── In-flight request de-duplication ────────────────────────────────────────
// No result caching — just prevents the exact same type+query from firing
// two overlapping network requests (e.g. debounce and Enter racing each other).
// The entry is removed as soon as the request settles, so nothing is reused
// after the fact; a repeat search always hits the API again.

const inFlightSearches = new Map<string, Promise<SearchResult[]>>();

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

export default function SearchIsland({ initialQuery = '', initialType = 'all', i18n }: Props) {
  const [isMounted, setIsMounted] = useState(false);
  const [query, setQuery]         = useState(initialQuery);
  const [mediaType, setMediaType] = useState<MediaType>(initialType);
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [status, setStatus]       = useState<SearchStatus>(initialQuery ? 'loading' : 'idle');
  const [sortField, setSortField] = useState<'releaseDate' | 'scoreGlobal'>('releaseDate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const debounceTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef        = useRef<AbortController | null>(null);
  const searchInputRef            = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setIsMounted(true);
  }, []);


  const executeSearch = useCallback(async (searchQuery: string, type: MediaType) => {
    if (searchQuery.length < 2) {
      setStatus('idle');
      setResults([]);
      return;
    }

    setStatus('loading');

    // If the exact same type+query is already in flight (e.g. debounce and
    // Enter racing each other), ride that request instead of firing another
    // one — this is the only thing avoided, no results are ever reused later.
    const key = `${type}:${searchQuery.toLowerCase()}`;
    let promise = inFlightSearches.get(key);
    if (!promise) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = new AbortController();
      promise = search(searchQuery, type, abortControllerRef.current.signal)
        .finally(() => inFlightSearches.delete(key));
      inFlightSearches.set(key, promise);
    }

    try {
      const searchResults = await promise;
      setResults(searchResults);
      setStatus('done');
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.set('type', type);
      currentUrl.searchParams.set('q', searchQuery);
      history.replaceState(null, '', currentUrl.toString());
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (!isAbort) {
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    if (initialQuery) executeSearch(initialQuery, initialType);
    return () => {
      abortControllerRef.current?.abort();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    setStatus('idle');
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('type', selectedType);
    currentUrl.searchParams.delete('q');
    history.replaceState(null, '', currentUrl.toString());
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

        {/* Tabs de tipo de medio (solo se renderizan en cliente para evitar fallos de hidratación de SVGs) */}
        <div className="search-tabs-row">
          <div className="search-tabs-inner" style={{ minHeight: '38px' }}>
            {isMounted ? (
              MEDIA_TYPE_IDS.map(typeId => (
                <button
                  key={typeId}
                  onClick={() => handleMediaTypeChange(typeId)}
                  className={`search-tab${mediaType === typeId ? ' active' : ''}`}
                >
                  {TAB_ICONS[typeId]}
                  {i18n.types[typeId]}
                </button>
              ))
            ) : (
              // Esqueleto/placeholder vacío en servidor para prevenir saltos de layout
              <div style={{ opacity: 0 }}>Cargando filtros...</div>
            )}
          </div>
        </div>


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

        {status === 'done' && results.length === 0 && (
          <div className="results-empty">
            {interpolateTemplate(i18n.no_results, { q: query })}
          </div>
        )}

        {sortedResults.length > 0 && (
          <div className="results-grid animate-fade-in">
            {sortedResults.map(result => (
              <MediaCard key={result.externalId} result={result} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaCard({ result }: { result: SearchResult }) {
  const hasDetail = (DETAIL_SUPPORTED_TYPES as readonly string[]).includes(result.type);

  function handleMouseEnter() {
    if (hasDetail && result.type !== 'character') prefetchMediaData(result.externalId);
  }

  function handleClick() {
    if (hasDetail) {
      if (result.type === 'character') {
        const rawId = result.externalId.replace('character:', '');
        window.location.href = `/character?id=${rawId}`;
        return;
      }
      if (result.authorNames?.length) {
        sessionStorage.setItem(`book_authors:${result.externalId}`, JSON.stringify(result.authorNames));
      }
      if (result.authorKey) {
        sessionStorage.setItem(`book_author_key:${result.externalId}`, result.authorKey);
      }
      window.location.href = `/media?id=${result.externalId}`;
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
      <div className="card-media-base aspect-[3/4] mb-1.5">
        {result.coverUrl ? (
          <img
            src={result.coverUrl}
            alt={result.titleMain}
            className="card-media-img"
            loading="lazy"
          />
        ) : (
          <div className="card-media-placeholder" />
        )}
        {result.scoreGlobal !== null && (
          <div className="card-rating-badge">{result.scoreGlobal.toFixed(1)}</div>
        )}
      </div>
      <p className="card-title">{result.titleMain}</p>
      {result.releaseYear && (
        <p className="card-year">{result.releaseYear}</p>
      )}
    </div>
  );
}
