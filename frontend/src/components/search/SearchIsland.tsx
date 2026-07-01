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
  const [query, setQuery]         = useState(initialQuery);
  const [mediaType, setMediaType] = useState<MediaType>(initialType);
  const [results, setResults]     = useState<SearchResult[]>([]);
  const [status, setStatus]       = useState<SearchStatus>(initialQuery ? 'loading' : 'idle');
  const debounceTimerRef          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef        = useRef<AbortController | null>(null);
  const searchInputRef            = useRef<HTMLInputElement>(null);

  const executeSearch = useCallback(async (searchQuery: string, type: MediaType) => {
    if (searchQuery.length < 2) {
      setStatus('idle');
      setResults([]);
      return;
    }

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    setStatus('loading');
    try {
      const searchResults = await search(searchQuery, type, signal);
      setResults(searchResults);
      setStatus('done');
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (!isAbort) {
        console.error('[search]', error);
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
    if (query.length >= 2) executeSearch(query, mediaType);
  };

  const activeMediaTypeLabel = i18n.types[mediaType].toLowerCase();

  return (
    <div className="min-h-screen flex flex-col">

      <div className="search-header">

        {/* Tabs de tipo de medio */}
        <div className="search-tabs-row">
          <div className="search-tabs-inner">
            {MEDIA_TYPE_IDS.map(typeId => (
              <button
                key={typeId}
                onClick={() => handleMediaTypeChange(typeId)}
                className={`search-tab${mediaType === typeId ? ' active' : ''}`}
              >
                {TAB_ICONS[typeId]}
                {i18n.types[typeId]}
              </button>
            ))}
          </div>
        </div>

        {/* Barra de búsqueda */}
        <div className="search-bar-row">
          <div className="search-input-wrap">
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

        {results.length > 0 && (
          <div className="results-grid animate-fade-in">
            {results.map(result => (
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
