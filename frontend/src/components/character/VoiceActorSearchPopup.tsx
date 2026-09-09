import { useState } from 'react';
import { createPortal } from 'react-dom';
import { searchAniListStaff, type AniListStaffSearchResult } from '../../lib/search/providers/anilist';
import { useDebouncedSearch, dedupeByKey } from '../../lib/shared/useDebouncedSearch';
import { getT } from '../../i18n/client';

export interface VoiceActorSearchPopupProps {
  onSelect: (result: AniListStaffSearchResult) => void;
  onClose: () => void;
  excludeIds?: string[];
  closeOnSelect?: boolean;
}

export function VoiceActorSearchPopup({ onSelect, onClose, excludeIds = [], closeOnSelect = false }: VoiceActorSearchPopupProps) {
  const ce = getT().character_editor;
  const [query, setQuery] = useState('');
  const { results, isLoading } = useDebouncedSearch<AniListStaffSearchResult>(
    query,
    (q, signal) => searchAniListStaff(q, signal).then(page => page.results),
  );

  const filteredResults = dedupeByKey(
    results.filter(r => !excludeIds.includes(`person:a${r.id}`)),
    r => String(r.id),
  );

  const handleSelect = (r: AniListStaffSearchResult) => {
    if (closeOnSelect) onClose();
    onSelect(r);
  };

  const modal = (
    <div className="pr-editor-search-popup" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="pr-editor-search-popup-content pr-editor-search-popup-content--wide" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-search-controls">
          <input
            type="text"
            placeholder={ce.voice_actor_search_placeholder}
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            className="pr-editor-search-input"
            style={{ width: '100%' }}
          />
        </div>
        <div className="pr-editor-search-results pr-editor-search-results--grid">
          {isLoading && <div className="pr-editor-search-loading">{ce.voice_actor_search_loading}</div>}
          {!isLoading && filteredResults.length === 0 && query && (
            <div className="pr-editor-search-empty">{ce.voice_actor_search_no_results}</div>
          )}
          <div className="pr-editor-search-grid">
            {filteredResults.map(r => (
              <button
                key={r.id}
                type="button"
                className="pr-editor-search-result-card"
                onClick={() => handleSelect(r)}
              >
                {r.image ? (
                  <img src={r.image} alt="" className="pr-editor-search-result-cover" />
                ) : (
                  <div className="pr-editor-cover-placeholder" style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{ce.no_image}</div>
                )}
                <div className="pr-editor-search-result-info">
                  <div className="pr-editor-search-result-title">{r.name}</div>
                  {r.nameNative && <div className="pr-editor-search-result-id">{r.nameNative}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modal, document.body) : modal;
}
