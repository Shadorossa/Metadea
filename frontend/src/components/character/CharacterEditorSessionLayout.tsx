import React from 'react';
import { getT } from '../../i18n/runtime';
import type { PrEditorSessionTab } from '../../lib/media/editor/pr-editor-types';

interface CharacterEditorSessionLayoutProps {
  sharedSessionTabs: PrEditorSessionTab[];
  currentId: string;
  onNavigate: (tab: PrEditorSessionTab) => void;
  onTabContextMenu: (tab: PrEditorSessionTab, event: React.MouseEvent) => void;
  children: React.ReactNode;
}

// The shared media/character session's tab strip plus prev/next arrows,
// wrapped around the character panel when the editor is a session tab.
export function CharacterEditorSessionLayout({ sharedSessionTabs, currentId, onNavigate, onTabContextMenu, children }: CharacterEditorSessionLayoutProps) {
  const t = getT().character_editor;
  const tabs = sharedSessionTabs.length ? sharedSessionTabs : window.__metadeaPrEditorSession?.tabs ?? [];
  const activeIndex = tabs.findIndex(tab => tab.kind === 'character' && tab.externalId === currentId);
  const navigate = (index: number) => {
    if (!tabs.length) return;
    onNavigate(tabs[(index + tabs.length) % tabs.length]);
  };
  return (
    <div className="pr-editor-session-layout pr-editor-session-layout--active" onClick={event => event.stopPropagation()}>
      <nav className="pr-editor-session-tabs" aria-label={t.tabs_label}>
        {tabs.map((tab) => (
          <button
            key={`${tab.kind}:${tab.externalId}`}
            type="button"
            className={`pr-editor-session-tab${tab.kind === 'character' && tab.externalId === currentId ? ' pr-editor-session-tab--active' : ''}`}
            aria-current={tab.kind === 'character' && tab.externalId === currentId ? 'page' : undefined}
            title={`${tab.kind === 'character' ? t.tab_character : t.tab_work}: ${tab.label}${tab.dirty ? ` · ${t.unsaved_changes}` : ''}`}
            onClick={() => onNavigate(tab)}
            onContextMenu={event => onTabContextMenu(tab, event)}
          >
            <span className="pr-editor-session-tab-label">{tab.label}</span>
            {tab.dirty && <span className="pr-editor-session-tab-dirty" aria-label={t.unsaved_changes} />}
          </button>
        ))}
      </nav>
      <div className="pr-editor-session-panel-row">
        <button type="button" className="pr-editor-session-arrow" aria-label={t.session_prev} onClick={() => navigate(activeIndex - 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg></button>
        {children}
        <button type="button" className="pr-editor-session-arrow" aria-label={t.session_next} onClick={() => navigate(activeIndex + 1)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg></button>
      </div>
    </div>
  );
}
