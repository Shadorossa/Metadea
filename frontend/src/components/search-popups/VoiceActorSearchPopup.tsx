import { useState } from 'react';
import { ModalShell } from '../shared/ModalShell';
import { ImageOff } from 'lucide-react';
import { searchAniListStaff } from '../../lib/search/providers/anilist';
import { searchTmdbPeople } from '../../lib/search/providers/tmdb';
import { API_ENDPOINTS } from '../../lib/api/endpoints';
import { useDebouncedSearch, dedupeByKey } from '../shared/hooks/useDebouncedSearch';
import { getT } from '../../i18n/runtime';

export interface VoiceActorSearchResult {
  externalId: string;
  name: string;
  nameNative: string;
  image: string;
  provider: 'AniList' | 'TMDB';
}

export interface VoiceActorSearchPopupProps {
  onSelect: (result: VoiceActorSearchResult) => void;
  onClose: () => void;
  excludeIds?: string[];
}

export function VoiceActorSearchPopup({ onSelect, onClose, excludeIds = [] }: VoiceActorSearchPopupProps) {
  const ce = getT().character_editor;
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, VoiceActorSearchResult>>({});
  const { results, isLoading } = useDebouncedSearch<VoiceActorSearchResult>(
    query,
    async (q, signal) => {
      const [aniListResult, tmdbPeople] = await Promise.all([
        searchAniListStaff(q, signal).then(page => page.results).catch(() => []),
        searchTmdbPeople(q, signal).catch(() => []),
      ]);
      return [
        ...aniListResult.map(person => ({
          externalId: `person:a${person.id}`,
          name: person.name,
          nameNative: person.nameNative || '',
          image: person.image || '',
          provider: 'AniList' as const,
        })),
        ...tmdbPeople.map(person => ({
          externalId: `person:t${person.id}`,
          name: person.name,
          nameNative: '',
          image: person.profile_path ? API_ENDPOINTS.TMDB_IMAGE(person.profile_path, 'w185') : '',
          provider: 'TMDB' as const,
        })),
      ];
    },
  );

  const filteredResults = dedupeByKey(
    results.filter(result => !excludeIds.includes(result.externalId)),
    result => result.externalId,
  );
  const selectedIds = Object.keys(selected);

  const toggleSelected = (result: VoiceActorSearchResult) => {
    setSelected(current => {
      if (current[result.externalId]) {
        const { [result.externalId]: _removed, ...remaining } = current;
        return remaining;
      }
      return { ...current, [result.externalId]: result };
    });
  };

  const handleConfirm = () => {
    selectedIds.forEach(id => onSelect(selected[id]));
    onClose();
  };

  return (
    <ModalShell
      onClose={onClose}
      label={ce.voice_actor_search_placeholder}
      overlayClassName="pr-editor-search-popup"
      panelClassName="pr-editor-search-popup-content pr-editor-search-popup-content--wide"
      overlayProps={{ onClick: e => e.stopPropagation() }}
    >
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
            {filteredResults.map(result => (
              <button
                key={result.externalId}
                type="button"
                className={`pr-editor-search-result-card${selected[result.externalId] ? ' is-selected' : ''}`}
                aria-pressed={!!selected[result.externalId]}
                onClick={() => toggleSelected(result)}
              >
                {result.image ? (
                  <img src={result.image} alt="" className="pr-editor-search-result-cover" />
                ) : (
                  <div className="pr-editor-search-result-cover pr-editor-search-result-cover--placeholder" role="img" aria-label={ce.no_image}>
                    <ImageOff size={28} strokeWidth={1.6} aria-hidden="true" />
                  </div>
                )}
                <div className="pr-editor-search-result-info">
                  <div className="pr-editor-search-result-title pr-editor-voice-actor-result-title">
                    <span>{result.name}</span>
                    <img
                      src={result.provider === 'AniList' ? '/API/Anilist_logo.png' : '/API/Tmdb.new.logo.png'}
                      alt={`${result.provider} logo`}
                      title={result.provider}
                      className="media-store-icon"
                    />
                  </div>
                  {result.nameNative && <div className="pr-editor-search-result-id">{result.nameNative}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="pr-editor-search-cast-actions">
          <span>{selectedIds.length} seleccionados</span>
          <button
            type="button"
            className="pr-editor-btn pr-editor-btn--submit"
            onClick={handleConfirm}
            disabled={selectedIds.length === 0}
          >
            Añadir seleccionados
          </button>
        </div>
    </ModalShell>
  );
}
