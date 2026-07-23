import { useState } from 'react';
import { searchAniListStaff, type AniListStaffSearchResult } from '../../lib/search/providers/anilist';
import { useDebouncedSearch, dedupeByKey } from '../../lib/shared/useDebouncedSearch';

export interface VoiceActorSearchPopupProps {
  onSelect: (result: AniListStaffSearchResult) => void;
  onClose: () => void;
  excludeIds?: string[];
}

// Modeled on CharacterSearchPopup — AniList only for now (voice actors are
// modeled there as Staff, see anilist.ts's searchAniListStaff); a TMDB person
// search for live-action actors can plug in the same way later.
export function VoiceActorSearchPopup({ onSelect, onClose, excludeIds = [] }: VoiceActorSearchPopupProps) {
  const [query, setQuery] = useState('');
  const { results, isLoading } = useDebouncedSearch<AniListStaffSearchResult>(
    query,
    (q, signal) => searchAniListStaff(q, signal).then(page => page.results),
  );

  const filteredResults = dedupeByKey(
    results.filter(r => !excludeIds.includes(`person:a${r.id}`)),
    r => String(r.id),
  );

  return (
    <div className="pr-editor-search-popup" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="pr-editor-search-popup-content pr-editor-search-popup-content--wide" onClick={e => e.stopPropagation()}>
        <div className="pr-editor-search-controls">
          <input
            type="text"
            placeholder="Buscar actor de voz en AniList..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            className="pr-editor-search-input"
            style={{ width: '100%' }}
          />
        </div>
        <div className="pr-editor-search-results pr-editor-search-results--grid">
          {isLoading && <div className="pr-editor-search-loading">Buscando actores de voz...</div>}
          {!isLoading && filteredResults.length === 0 && query && (
            <div className="pr-editor-search-empty">No se encontraron actores de voz</div>
          )}
          <div className="pr-editor-search-grid">
            {filteredResults.map(r => (
              <button
                key={r.id}
                type="button"
                className="pr-editor-search-result-card"
                onClick={() => onSelect(r)}
              >
                {r.image ? (
                  <img src={r.image} alt="" className="pr-editor-search-result-cover" />
                ) : (
                  <div className="pr-editor-cover-placeholder" style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No Image</div>
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
}
