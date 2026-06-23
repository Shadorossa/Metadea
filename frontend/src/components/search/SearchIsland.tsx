import { useState, useCallback, useRef, useEffect } from 'react';
import { search, type MediaType, type SearchResult } from '../../lib/api/search';

const TYPES: { id: MediaType; label: string }[] = [
  { id: 'anime',  label: 'Anime'    },
  { id: 'manga',  label: 'Manga'    },
  { id: 'game',   label: 'Juegos'   },
  { id: 'movie',  label: 'Películas'},
  { id: 'series', label: 'Series'   },
  { id: 'book',   label: 'Libros'   },
];

type Status = 'idle' | 'loading' | 'done' | 'error';

interface Props {
  initialQ?: string;
  initialType?: MediaType;
}

export default function SearchIsland({ initialQ = '', initialType = 'anime' }: Props) {
  const [q, setQ]             = useState(initialQ);
  const [type, setType]       = useState<MediaType>(initialType);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus]   = useState<Status>(initialQ ? 'loading' : 'idle');
  const debounceRef           = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (query: string, mediaType: MediaType) => {
    if (query.length < 2) { setStatus('idle'); setResults([]); return; }
    setStatus('loading');
    try {
      const data = await search(query, mediaType);
      setResults(data);
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (initialQ) runSearch(initialQ, initialType);
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

  const activeLabel = TYPES.find(t => t.id === type)?.label ?? '';

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Sticky header: solo tabs + buscador, sin barra visual ── */}
      <div className="search-header">
        <div className="search-tabs-row">
          <div className="search-tabs-inner">
            {TYPES.map(t => (
              <button
                key={t.id}
                onClick={() => handleType(t.id)}
                className={`search-tab${type === t.id ? ' active' : ''}`}
              >
                {t.label}
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
              placeholder={`Buscar ${activeLabel.toLowerCase()}...`}
              autoFocus
              className="search-input"
            />
            {status === 'loading' && <span className="search-spinner" />}
          </div>
        </div>
      </div>

      {/* ── Resultados ── */}
      <div className="results-zone flex-1">
        {status === 'idle' && (
          <div className="search-idle">
            <p className="search-idle-label">Busca {activeLabel.toLowerCase()}</p>
            <p className="search-idle-hint">Escribe al menos 2 caracteres</p>
          </div>
        )}

        {status === 'error' && (
          <div className="results-empty" style={{ color: '#f87171' }}>
            Error al buscar. Inténtalo de nuevo.
          </div>
        )}

        {status === 'done' && results.length === 0 && (
          <div className="results-empty">
            Sin resultados para <strong style={{ color: 'var(--text-main)' }}>"{q}"</strong>
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
