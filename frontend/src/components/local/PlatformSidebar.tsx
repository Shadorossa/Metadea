import React from 'react';
import type { Translations } from '../../i18n/index';
import { LAUNCHER_ORDER, PLATFORM_LABEL, PLATFORM_LOGO, type PlatformId } from '../../lib/local/platforms';
import { IconFolder } from './ui/icons';

interface PlatformSidebarProps {
  // Server-safe strings until hydration (see LocalLibrary's ssrLocal).
  localT:             Translations['local'];
  activePlatform:     PlatformId | null;
  availablePlatforms: Set<string>;
  onSelect:           (id: PlatformId) => void;
  onFetchMetadata?:   () => void;
}

export function PlatformSidebar({ localT, activePlatform, availablePlatforms, onSelect, onFetchMetadata }: PlatformSidebarProps) {
  return (
    <aside className="local-platform-sidebar">
      {LAUNCHER_ORDER.map(id => (
        <button
          key={id}
          type="button"
          className={[
            'local-platform-btn',
            activePlatform === id     ? 'active'      : '',
            !availablePlatforms.has(id) ? 'unavailable' : '',
          ].filter(Boolean).join(' ')}
          onClick={() => onSelect(id)}
          title={PLATFORM_LABEL[id]}
          aria-label={PLATFORM_LABEL[id]}
        >
          <span className="local-platform-icon">
            {PLATFORM_LOGO[id] ? (
              <img src={PLATFORM_LOGO[id]} alt={PLATFORM_LABEL[id]} draggable={false} />
            ) : (
              <IconFolder size={20} />
            )}
          </span>
          <span className="local-platform-label">{PLATFORM_LABEL[id]}</span>
        </button>
      ))}

      {onFetchMetadata && (
        <>
          <div className="local-platform-divider" />
          <button
            type="button"
            className="local-platform-btn local-metadata-btn"
            onClick={onFetchMetadata}
            title={localT.fetch_igdb_metadata}
          >
            <span className="local-platform-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v13M5 9l7 7 7-7"/>
                <line x1="5" y1="21" x2="19" y2="21"/>
              </svg>
            </span>
            <span className="local-platform-label">{localT.metadata_label}</span>
          </button>
        </>
      )}
    </aside>
  );
}
