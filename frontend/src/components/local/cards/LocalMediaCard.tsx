import React from 'react';
import type { LocalMediaItem } from '../hooks/useLocalMediaEntries';
import { IconFolder } from '../ui/icons';

interface LocalMediaCardProps {
  item:    LocalMediaItem;
  onClick: (item: LocalMediaItem) => void;
}

// Reading types get "Cap." (chapters), everything else "Ep." (episodes) —
// same anime/series-vs-manga/lnovel/book split used for the history label
// in LocalMediaDetailPanel.tsx.
const READING_TYPES = new Set(['manga', 'lnovel', 'book']);

export function LocalMediaCard({ item, onClick }: LocalMediaCardProps) {
  // Visual novels AND games both log progress as hours played (see
  // getProgressConfig in MediaEditorModal), not a discrete episode/chapter
  // count, so the badge needs its own unit here instead of falling into
  // either "Cap." or "Ep." — this card is also used for Videojuegos' own
  // library-only "Pendiente"/"En progreso" entries (see LocalLibrary), not
  // just the Visual Novel tab.
  const isHourBased = item.libraryEntry.type === 'vnovel' || item.libraryEntry.type === 'game';
  const unitLabel = READING_TYPES.has(item.libraryEntry.type) ? 'Cap.' : 'Ep.';
  const badgeLabel = item.status === 'planning'
    ? 'Pendiente'
    : isHourBased ? `${item.progress}h` : `${unitLabel} ${item.progress}`;
  return (
    <div
      className="local-game-card"
      onClick={() => onClick(item)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(item)}
    >
      <div className="local-game-cover">
        {item.cover
          ? <img src={item.cover} alt={item.title} loading="lazy" decoding="async" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div className="local-game-cover-placeholder"><IconFolder /></div>}
        <span className={`local-media-status-badge${item.status === 'planning' ? ' local-media-status-badge--planning' : ''}`}>
          {badgeLabel}
        </span>
      </div>
      <p className="local-game-name">{item.title}</p>
    </div>
  );
}
