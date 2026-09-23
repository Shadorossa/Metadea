import { useState } from 'react';
import { ModalShell } from '../shared/ModalShell';
import type { TierCandidate } from '../../lib/tier/tier-candidates';
import type { Translations } from '../../i18n/types';
import type { TierLibraryData } from './hooks/useTierLibraryData';
import { TierLibraryPanel, TierTemplatesPanel } from './TierLibraryPanel';
import { TierCharactersPanel, TierCollectionsPanel } from './TierCollectionsPanel';

// "Add items" dialog. Works lists get Library / Quick fill / Lists & sagas
// / Search; character lists get Characters / Search. Search itself is the
// shared MediaSearchPopup / CharacterSearchPopup, opened by the editor in
// place of this dialog (two stacked modals would fight over focus).

type FillerTab = 'library' | 'templates' | 'collections' | 'characters' | 'search';

interface Props {
  listType: 'works' | 'characters';
  library: TierLibraryData;
  exclude: ReadonlySet<string>;
  onAdd: (candidates: TierCandidate[]) => void;
  onOpenSearch: () => void;
  onClose: () => void;
  t: Translations['tier'];
  p: Translations['profile'];
}

export function TierPoolFiller({ listType, library, exclude, onAdd, onOpenSearch, onClose, t, p }: Props) {
  const tabs: FillerTab[] = listType === 'characters'
    ? ['characters', 'search']
    : ['library', 'templates', 'collections', 'search'];
  const [tab, setTab] = useState<FillerTab>(tabs[0]);
  const labels: Record<FillerTab, string> = {
    library: t.filler_tab_library,
    templates: t.filler_tab_templates,
    collections: t.filler_tab_collections,
    characters: t.filler_tab_characters,
    search: t.filler_tab_search,
  };

  return (
    <ModalShell onClose={onClose} label={t.filler_title} overlayClassName="tier-modal-overlay" panelClassName="tier-modal tier-filler">
      <header className="tier-modal-header">
        <h2 className="tier-modal-title">{t.filler_title}</h2>
        <button type="button" className="tier-icon-btn" aria-label={t.close} title={t.close} onClick={onClose}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <div className="tier-tabs" role="tablist" aria-label={t.filler_title}>
        {tabs.map(id => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`tier-filler-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="tier-filler-tabpanel"
            className={`tier-tab${tab === id ? ' tier-tab--active' : ''}`}
            onClick={() => setTab(id)}
          >
            {labels[id]}
          </button>
        ))}
      </div>
      <div className="tier-filler-body" role="tabpanel" id="tier-filler-tabpanel" aria-labelledby={`tier-filler-tab-${tab}`}>
        {tab === 'library' && <TierLibraryPanel data={library} exclude={exclude} onAdd={onAdd} t={t} p={p} />}
        {tab === 'templates' && <TierTemplatesPanel data={library} exclude={exclude} onAdd={onAdd} t={t} />}
        {tab === 'collections' && <TierCollectionsPanel exclude={exclude} onAdd={onAdd} t={t} />}
        {tab === 'characters' && <TierCharactersPanel exclude={exclude} onAdd={onAdd} t={t} />}
        {tab === 'search' && (
          <div className="tier-filler-panel tier-filler-search">
            <p>{t.search_hint}</p>
            <button type="button" className="tier-btn tier-btn--primary" onClick={onOpenSearch}>
              {listType === 'characters' ? t.search_open_characters : t.search_open_works}
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
