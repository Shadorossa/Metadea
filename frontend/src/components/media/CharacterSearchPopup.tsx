import React, { useState, useEffect } from 'react';
import { search, type SearchResult as ApiSearchResult } from '../../lib/search';

export interface CharacterSearchPopupProps {
  onSelect: (result: ApiSearchResult) => void;
  onClose: () => void;
  excludeIds?: string[];
}

export function CharacterSearchPopup({ onSelect, onClose, excludeIds = [] }: CharacterSearchPopupProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ApiSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsLoading(true);
      search(query, 'character', controller.signal)
        .then(res => {
          if (controller.signal.aborted) return;
          setResults(res.slice(0, 60));
        })
        .catch(() => {
          if (!controller.signal.aborted) setResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const filteredResults = results.filter(r => !excludeIds.includes(r.externalId));

  return (
    <div className="pr-editor-search-popup" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="pr-editor-search-popup-content pr-editor-search-popup-content--wide" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-search-controls">
          <input
            type="text"
            placeholder="Buscar personajes en AniList..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            className="pr-editor-search-input"
            style={{ width: '100%' }}
          />
        </div>
        <div className="pr-editor-search-results pr-editor-search-results--grid">
          {isLoading && <div className="pr-editor-search-loading">Buscando personajes...</div>}
          {!isLoading && filteredResults.length === 0 && query && (
            <div className="pr-editor-search-empty">No se encontraron personajes</div>
          )}
          <div className="pr-editor-search-grid">
             {(() => {
                const seen = new Set();
                return filteredResults
                  .filter(r => {
                    if (seen.has(r.externalId)) return false;
                    seen.add(r.externalId);
                    return true;
                  })
                  .map(r => (
                    <button
                      key={r.externalId}
                      type="button"
                      className="pr-editor-search-result-card"
                      onClick={() => {
                        onSelect(r);
                      }}
                    >
                      {r.coverUrl ? (
                        <img src={r.coverUrl} alt="" className="pr-editor-search-result-cover" />
                      ) : (
                        <div className="pr-editor-cover-placeholder" style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No Image</div>
                      )}
                      <div className="pr-editor-search-result-info">
                        <div className="pr-editor-search-result-id">{r.externalId}</div>
                        <div className="pr-editor-search-result-title">{r.titleMain || '—'}</div>
                      </div>
                    </button>
                  ));
             })()}
          </div>
        </div>
      </div>
    </div>
  );
}
