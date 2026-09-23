import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Translations } from '../../../i18n/index';
import type { PrEditorSessionTab } from '../../../lib/media/editor/pr-editor-types';

export interface SessionTabContextMenuState {
  externalId: string;
  kind?: 'media' | 'character';
  x: number;
  y: number;
}

interface LayoutProps {
  pe: Translations['pr_editor'];
  externalId: string;
  sessionMode: boolean;
  sessionTabs: PrEditorSessionTab[];
  onNavigateSessionEntry?: (externalId: string) => void;
  onNavigateSessionTab?: (tab: PrEditorSessionTab) => void;
  onTabContextMenu: (menu: SessionTabContextMenuState) => void;
  children: React.ReactNode;
}

// Wraps the modal panel with the proposal session's tab strip and prev/next
// arrows (only rendered in session mode); the panel itself is `children`.
export function PrEditorSessionLayout({ pe, externalId, sessionMode, sessionTabs, onNavigateSessionEntry, onNavigateSessionTab, onTabContextMenu, children }: LayoutProps) {
  const activeIndex = sessionTabs.findIndex(tab => tab.kind !== 'character' && tab.externalId === externalId);
  const navigate = (index: number) => {
    const targetIndex = (index + sessionTabs.length) % sessionTabs.length;
    const target = sessionTabs[targetIndex];
    if (target && !(target.kind !== 'character' && target.externalId === externalId)) {
      if (onNavigateSessionTab) onNavigateSessionTab(target);
      else onNavigateSessionEntry?.(target.externalId);
    }
  };
  return (
    <div className={`pr-editor-session-layout${sessionMode ? ' pr-editor-session-layout--active' : ''}`} onClick={event => event.stopPropagation()}>
      {sessionMode && (
        <nav className="pr-editor-session-tabs" aria-label={pe.session_tabs_label}>
          {sessionTabs.map((tab, index) => (
            <button
              key={`${tab.kind ?? 'media'}:${tab.externalId}`}
              type="button"
              className={`pr-editor-session-tab${tab.kind !== 'character' && tab.externalId === externalId ? ' pr-editor-session-tab--active' : ''}${tab.affected ? ' pr-editor-session-tab--affected' : ''}`}
              aria-current={tab.kind !== 'character' && tab.externalId === externalId ? 'page' : undefined}
              title={`${tab.kind === 'character' ? pe.session_tab_character : pe.session_tab_work}${tab.label}${tab.dirty ? ` · ${pe.unsaved_changes}` : ''}${tab.affected ? ` · ${pe.related_change}` : ''}`}
                onClick={() => navigate(index)}
              onContextMenu={event => {
                event.preventDefault();
                onTabContextMenu({ externalId: tab.externalId, kind: tab.kind, x: event.clientX, y: event.clientY });
              }}
            >
              <span className="pr-editor-session-tab-label">{tab.label}</span>
              {tab.dirty && <span className="pr-editor-session-tab-dirty" aria-label={pe.unsaved_changes} />}
              {tab.affected && <span className="pr-editor-session-tab-affected" aria-label={pe.related_change}>↗</span>}
            </button>
          ))}
        </nav>
      )}
      <div className="pr-editor-session-panel-row">
        {sessionMode && (
          <button type="button" className="pr-editor-session-arrow" aria-label={pe.prev_work} title={pe.prev_work} disabled={sessionTabs.length <= 1} onClick={() => navigate(activeIndex - 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
          </button>
        )}
        {children}
        {sessionMode && (
          <button type="button" className="pr-editor-session-arrow" aria-label={pe.next_work} title={pe.next_work} disabled={sessionTabs.length <= 1} onClick={() => navigate(activeIndex + 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        )}
      </div>
    </div>
  );
}

interface ContextMenuProps {
  menu: SessionTabContextMenuState;
  sessionTabs: PrEditorSessionTab[];
  onRequestCloseSessionEntry?: (externalId: string) => void;
  onRequestCloseSessionTab?: (tab: PrEditorSessionTab) => void;
  onClose: () => void;
}

// Right-click menu on a session tab ("close this tab"). Dismisses itself on
// any pointer down elsewhere or Escape, and focuses its one action on open so
// it's reachable without a mouse (see local/ui/DeleteContextMenu). Escape is
// taken in the capture phase and marked handled so the editor's ModalShell
// (which listens on document and skips defaultPrevented keys) doesn't also
// treat it as "close the editor".
export function PrEditorSessionTabContextMenu({ menu, sessionTabs, onRequestCloseSessionEntry, onRequestCloseSessionTab, onClose }: ContextMenuProps) {
  const itemRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { itemRef.current?.focus(); }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('pointerdown', onClose);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onClose);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="pr-editor-session-tab-context-menu"
      role="menu"
      style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 58) }}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <button ref={itemRef} type="button" role="menuitem" onClick={() => {
        const tab = sessionTabs.find(item => item.externalId === menu.externalId && item.kind === menu.kind);
        if (tab && onRequestCloseSessionTab) onRequestCloseSessionTab(tab);
        else onRequestCloseSessionEntry?.(menu.externalId);
        onClose();
      }}>
        Cerrar pestaña
      </button>
    </div>,
    document.body,
  );
}
