import React from 'react';
import type { LocalMediaItem } from '../hooks/useLocalMediaEntries';
import { IconFolder } from '../ui/icons';

interface LocalMediaCardProps {
  item:    LocalMediaItem;
  onClick: (item: LocalMediaItem) => void;
}

export function LocalMediaCard({ item, onClick }: LocalMediaCardProps) {
  const badgeLabel = item.status === 'planning' ? 'Pendiente' : `Ep. ${item.progress}`;

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
          ? <img src={item.cover} alt={item.title} loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div className="local-game-cover-placeholder"><IconFolder /></div>}
        <span className={`local-media-status-badge${item.status === 'planning' ? ' local-media-status-badge--planning' : ''}`}>
          {badgeLabel}
        </span>
      </div>
      <p className="local-game-name">{item.title}</p>
    </div>
  );
}
