import React, { useState } from 'react';
import { search, type SearchResult as ApiSearchResult } from '../../lib/search';
import { useDebouncedSearch, dedupeByKey } from '../../lib/shared/useDebouncedSearch';
import { getT } from '../../i18n/client';

export interface CharacterSearchPopupProps {
  onSelect: (result: ApiSearchResult) => void;
  onClose: () => void;
  excludeIds?: string[];
}

export function CharacterSearchPopup({ onSelect, onClose, excludeIds = [] }: CharacterSearchPopupProps) {
  const t = getT();
  const ce = t.character_editor;
  const [query, setQuery] = useState('');
  const { results, isLoading } = useDebouncedSearch<ApiSearchResult>(
    query,
    (q, signal) => search(q, 'character', signal).then(page => page.results.slice(0, 60)),
  );

  const filteredResults = dedupeByKey(
    results.filter(r => !excludeIds.includes(r.externalId)),
    r => r.externalId,
  );

  return (
    <div className="pr-editor-search-popup" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="pr-editor-search-popup-content pr-editor-search-popup-content--wide" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-search-controls">
          <input
            type="text"
            placeholder={ce.search_placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            className="pr-editor-search-input"
            style={{ width: '100%' }}
          />
        </div>
        <div className="pr-editor-search-results pr-editor-search-results--grid">
          {isLoading && <div className="pr-editor-search-loading">{ce.search_loading}</div>}
          {!isLoading && filteredResults.length === 0 && query && (
            <div className="pr-editor-search-empty">{ce.search_no_results}</div>
          )}
          <div className="pr-editor-search-grid">
            {filteredResults.map(r => (
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
                  <div className="pr-editor-cover-placeholder" style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ce.no_image}</div>
                )}
                <div className="pr-editor-search-result-info">
                  <div className="pr-editor-search-result-id">{r.externalId}</div>
                  <div className="pr-editor-search-result-title">{r.titleMain || '—'}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
