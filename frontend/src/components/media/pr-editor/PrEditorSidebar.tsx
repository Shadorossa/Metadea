import React from 'react';
import { BookOpen, Boxes, Clapperboard, GitBranch, Layers, Link, List, Music2, Package, Settings, Sparkles, Users, type LucideIcon } from 'lucide-react';
import type { Translations } from '../../../i18n/index';

export type PrEditorTab = 'general' | 'cast' | 'relations';
export type RelationsSubtab = 'saga' | 'relations' | 'recommendations' | 'bundled' | 'arcs' | 'issues' | 'episodes' | 'themes' | 'bundle-children' | 'contains';

const RELATIONS_SUBTAB_ICONS: Record<RelationsSubtab, LucideIcon> = {
  saga: GitBranch,
  relations: Link,
  recommendations: Sparkles,
  bundled: Package,
  arcs: Layers,
  issues: BookOpen,
  episodes: Clapperboard,
  themes: Music2,
  'bundle-children': Boxes,
  contains: List,
};

interface Props {
  pe: Translations['pr_editor'];
  activeTab: PrEditorTab;
  relationsSubtab: RelationsSubtab;
  relationsSubtabs: Array<{ id: RelationsSubtab; label: string }>;
  charactersChanged: boolean;
  onSelectTab: (tab: 'general' | 'cast') => void;
  onSelectRelationsSubtab: (subtab: RelationsSubtab) => void;
}

// Icon rail on the modal's left: General, Cast, then one icon per visible
// relations subtab.
export function PrEditorSidebar({ pe, activeTab, relationsSubtab, relationsSubtabs, charactersChanged, onSelectTab, onSelectRelationsSubtab }: Props) {
  return (
    <nav className="pr-editor-sidebar" aria-label={pe.sidebar_label}>
      <button
        type="button"
        className={`pr-editor-tab-btn${activeTab === 'general' ? ' active' : ''}`}
        onClick={() => onSelectTab('general')}
        title={pe.tab_general}
        aria-label={pe.tab_general}
        aria-current={activeTab === 'general' ? 'page' : undefined}
      >
        <Settings size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`pr-editor-tab-btn${activeTab === 'cast' ? ' active' : ''}`}
        onClick={() => onSelectTab('cast')}
        title={pe.tab_cast}
        aria-label={pe.tab_cast}
        aria-current={activeTab === 'cast' ? 'page' : undefined}
      >
        <Users size={18} aria-hidden="true" />
        {charactersChanged && <span className="pr-editor-tab-changed-dot" />}
      </button>
      <div className="pr-editor-sidebar-divider" />
      {relationsSubtabs.map(tab => {
        const Icon = RELATIONS_SUBTAB_ICONS[tab.id];
        const isActive = activeTab === 'relations' && relationsSubtab === tab.id;
        return (
          <React.Fragment key={tab.id}>
            {tab.id === 'episodes' && <div className="pr-editor-sidebar-divider" />}
            <button
              type="button"
              className={`pr-editor-tab-btn${isActive ? ' active' : ''}`}
              onClick={() => onSelectRelationsSubtab(tab.id)}
              title={tab.label}
              aria-label={tab.label}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={18} aria-hidden="true" />
            </button>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
