import React from 'react';
import type { LocalGame } from '../../../lib/tauri';
import { IconMonitor } from '../ui/icons';
import type { CoverCache } from '../details/GameDetailPanel';

interface GameCardProps {
  game:       LocalGame;
  coverCache: CoverCache;
  onClick:    (game: LocalGame) => void;
  // Optional label ("En progreso"/"Pendiente"/...) reflecting this game's
  // matched library status — the platform-grouped view still wants status
  // visible per-card even though it groups by launcher, not by status.
  statusLabel?: string;
  isPlanning?: boolean;
}

export function GameCard({ game, coverCache, onClick, statusLabel, isPlanning }: GameCardProps) {
  const cover = (game.app_id ? coverCache[game.app_id]?.cover : undefined) ?? null;

  return (
    <div
      className="local-game-card"
      onClick={() => onClick(game)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(game)}
    >
      <div className="local-game-cover">
        {cover
          ? <img src={cover} alt={game.name} loading="lazy" decoding="async" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div className="local-game-cover-placeholder"><IconMonitor /></div>
        }
        {statusLabel && (
          <span className={`local-media-status-badge${isPlanning ? ' local-media-status-badge--planning' : ''}`}>
            {statusLabel}
          </span>
        )}
      </div>
      <p className="local-game-name">{game.name}</p>
    </div>
  );
}
