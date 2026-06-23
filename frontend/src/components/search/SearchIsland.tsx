import { useState, useCallback, useRef, useEffect } from 'react';
import { search, type MediaType, type SearchResult } from '../../lib/api/search';
import type { Translations } from '../../i18n/index';

type SearchI18n = Translations['search'];

const TYPE_IDS: MediaType[] = ['anime', 'manga', 'game', 'movie', 'series', 'book'];

type Status = 'idle' | 'loading' | 'done' | 'error';

interface Props {
  initialQ?: string;
  initialType?: MediaType;
  i18n: SearchI18n;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (str, [key, val]) => str.replace(`{${key}}`, val),
    template,
  );
}

export default function SearchIsland({ initialQ = '', initialType = 'anime', i18n }: Props) {
  const [q, setQ]             = useState(initialQ);
  const [type, setType]       = useState<MediaType>(initialType);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus]   = useState<Status>(initialQ ? 'loading' : 'idle');
  const debounceRef           = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef              = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (query: string, mediaType: MediaType) => {
    if (query.length < 2) { setStatus('idle'); setResults([]); return; }

    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const { signal } = abortRef.current;

    setStatus('loading');
    try {
      const data = await search(query, mediaType, signal);
      setResults(data);
      setStatus('done');
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    if (initialQ) runSearch(initialQ, initialType);
    return () => abortRef.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInput = (value: string) => {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value, type), 400);
  };

  const handleType = (next: MediaType) => {
    setType(next);
    const url = new URL(window.location.href);
    url.searchParams.set('type', next);
    if (q) url.searchParams.set('q', q); else url.searchParams.delete('q');
    history.replaceState(null, '', url.toString());
    if (q.length >= 2) runSearch(q, next);
  };

  const activeLabel = i18n.types[type].toLowerCase();

  return (
    <div className="min-h-screen flex flex-col">

      <div className="search-header">
        <div className="search-tabs-row">
          <div className="search-tabs-inner">
            {TYPE_IDS.map(id => (
              <button
                key={id}
                onClick={() => handleType(id)}
                className={`search-tab${type === id ? ' active' : ''}`}
              >
                {i18n.types[id]}
              </button>
            ))}
          </div>
        </div>

        <div className="search-bar-row">
          <div className="search-input-wrap">
            <input
              type="search"
              value={q}
              onChange={e => handleInput(e.target.value)}
              placeholder={interpolate(i18n.placeholder, { type: activeLabel })}
              autoFocus
              className="search-input"
            />
            {status === 'loading' && <span className="search-spinner" />}
          </div>
        </div>
      </div>

      <div className="results-zone flex-1">
        {status === 'idle' && (
          <div className="search-idle">
            <p className="search-idle-label">
              {interpolate(i18n.idle_label, { type: activeLabel })}
            </p>
            <p className="search-idle-hint">{i18n.idle_hint}</p>
          </div>
        )}

        {status === 'error' && (
          <div className="results-empty" style={{ color: '#f87171' }}>
            {i18n.error}
          </div>
        )}

        {status === 'done' && results.length === 0 && (
          <div className="results-empty">
            {interpolate(i18n.no_results, { q })}
          </div>
        )}

        {results.length > 0 && (
          <div className="results-grid animate-fade-in">
            {results.map(r => <MediaCard key={r.externalId} result={r} />)}
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
        {result.cover ? (
          <img src={result.cover} alt={result.title} className="card-media-img" loading="lazy" />
        ) : (
          <div className="w-full h-full" style={{ background: 'linear-gradient(160deg, var(--bg-card), rgba(192,132,252,0.08))' }} />
        )}
        {result.score !== null && (
          <div className="card-rating-badge">{result.score.toFixed(1)}</div>
        )}
      </div>

      <p className="text-[12px] font-medium line-clamp-1 leading-snug tracking-tight px-0.5" style={{ color: 'var(--text-muted)' }}>
        {result.title}
      </p>
      {result.year && (
        <p className="text-[10px] mt-0.5 px-0.5" style={{ color: 'var(--text-dim)' }}>
          {result.year}
        </p>
      )}
    </div>
  );
}
