import { useState, useCallback, useRef, useEffect } from 'react';
import { search, type MediaType, type SearchResult } from '../../lib/search';
import type { Translations } from '../../i18n/index';

type SearchTranslations = Translations['search'];

// ── Tab icons ────────────────────────────────────────────────────────────────

const TAB_ICONS: Record<MediaType, JSX.Element> = {
  all:    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>,
  anime:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>,
  manga:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>,
  novel:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>,
  game:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4M8 10v4"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="18" cy="10" r="1" fill="currentColor"/></svg>,
  vnovel:     <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  movie:  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M17 7h5M2 17h5M17 17h5"/></svg>,
  series: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58A2.78 2.78 0 0 0 3.41 19.6C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.95A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z"/><polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="currentColor" stroke="none"/></svg>,
  book:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  user:   <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
};

const MEDIA_TYPE_IDS: MediaType[] = ['all', 'anime', 'manga', 'novel', 'game', 'vnovel', 'movie', 'series', 'book', 'user'];

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
      if (error instanceof Error && error.name !== 'AbortError') {
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    if (initialQuery) executeSearch(initialQuery, initialType);
    return () => abortControllerRef.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => executeSearch(value, mediaType), 400);
  };

  const handleMediaTypeChange = (selectedType: MediaType) => {
    setMediaType(selectedType);
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('type', selectedType);
    if (query) {
      currentUrl.searchParams.set('q', query);
    } else {
      currentUrl.searchParams.delete('q');
    }
    history.replaceState(null, '', currentUrl.toString());
    if (query.length >= 2) executeSearch(query, selectedType);
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
          <div className="results-empty" style={{ color: '#f87171' }}>{i18n.error}</div>
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
  return (
    <div className="group flex flex-col" style={{ cursor: 'pointer' }}>
      <div className="card-media-base aspect-[3/4] mb-1.5">
        {result.coverUrl ? (
          <img
            src={result.coverUrl}
            alt={result.titleMain}
            className="card-media-img"
            loading="lazy"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{ background: 'linear-gradient(160deg, var(--bg-card), rgba(192,132,252,0.08))' }}
          />
        )}
        {result.scoreGlobal !== null && (
          <div className="card-rating-badge">{result.scoreGlobal.toFixed(1)}</div>
        )}
      </div>
      <p
        className="text-[12px] font-medium line-clamp-1 leading-snug tracking-tight px-0.5"
        style={{ color: 'var(--text-muted)' }}
      >
        {result.titleMain}
      </p>
      {result.releaseYear && (
        <p className="text-[10px] mt-0.5 px-0.5" style={{ color: 'var(--text-dim)' }}>
          {result.releaseYear}
        </p>
      )}
    </div>
  );
}
