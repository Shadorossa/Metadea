import { useMemo, useState } from 'react';
import type { FavoriteCustomImage, CatalogSummary, ListInfo } from '../../../lib/tauri';
import type { CharacterEntry } from '../../../lib/tauri/characters';
import { getT } from '../../../i18n/runtime';
import { nextUntitledListName } from '../../../lib/profile/list-display';
import { ListCard } from './ListCard';

type P = ReturnType<typeof getT>['profile'];

export function ListsGrid({ customLists, catalogMap, charactersMap, customImagesMap, p, onCreate, onOpen, activeKey, readOnly }: {
  customLists: ListInfo[];
  catalogMap: Map<string, CatalogSummary>;
  charactersMap?: Map<string, CharacterEntry>;
  customImagesMap?: Map<string, FavoriteCustomImage>;
  p: P;
  onCreate: (name: string, description: string) => void;
  onOpen: (key: string) => void;
  activeKey?: string | null;
  readOnly?: boolean;
}) {
  const [filterMode, setFilterMode] = useState<'all' | 'media' | 'characters' | 'episodes'>('all');
  const showMedia = filterMode === 'all' || filterMode === 'media';
  const showCharacters = filterMode === 'all' || filterMode === 'characters';
  const showEpisodes = filterMode === 'all' || filterMode === 'episodes';

  const toggleFilter = (type: 'media' | 'characters' | 'episodes') => {
    if (filterMode === type) {
      setFilterMode('all');
    } else {
      setFilterMode(type);
    }
  };

  const filteredLists = useMemo(() => {
    if (filterMode === 'all') return customLists;
    if (filterMode === 'media') return customLists.filter(l => l.list_type !== 'characters' && l.list_type !== 'episodes');
    if (filterMode === 'characters') return customLists.filter(l => l.list_type === 'characters');
    return customLists.filter(l => l.list_type === 'episodes');
  }, [customLists, filterMode]);

  return (
    <div className="lists-layout">
      <div className="lists-header">
        <div className="lists-header-left">
          <h2 className="lists-title">{p.lists}</h2>
          <div className="lists-filter-selector" role="group">
            <button
              type="button"
              className={`lists-filter-btn${showMedia ? ' lists-filter-btn--active' : ''}`}
              onClick={() => toggleFilter('media')}
              title={p.lists_type_media}
              aria-label={p.lists_type_media}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
            </button>
            <button
              type="button"
              className={`lists-filter-btn${showCharacters ? ' lists-filter-btn--active' : ''}`}
              onClick={() => toggleFilter('characters')}
              title={p.lists_type_characters}
              aria-label={p.lists_type_characters}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </button>
            <button
              type="button"
              className={`lists-filter-btn${showEpisodes ? ' lists-filter-btn--active' : ''}`}
              onClick={() => toggleFilter('episodes')}
              title={p.lists_type_episodes || 'Episodios'}
              aria-label={p.lists_type_episodes || 'Episodios'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
                <polyline points="17 2 12 7 7 2" />
              </svg>
            </button>
          </div>
        </div>
        {!readOnly && (
          <button
            className="list-btn list-btn--primary lists-create-btn"
            onClick={() => onCreate(nextUntitledListName(customLists.map(l => l.name), p.lists_untitled), '')}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            {p.lists_new}
          </button>
        )}
      </div>
      {filteredLists.length > 0 ? (
        <div className="lists-grid">
          {filteredLists.map(l => (
            <ListCard
              list={l}
              catalogMap={catalogMap}
              charactersMap={charactersMap}
              customImagesMap={customImagesMap}
              p={p}
              active={l.key === activeKey}
              onClick={() => onOpen(l.key)}
              key={l.key}
            />
          ))}
        </div>
      ) : (
        <div className="lists-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>
          <p>{customLists.length > 0 ? p.lists_no_results : p.lists_empty}</p>
        </div>
      )}
    </div>
  );
}
