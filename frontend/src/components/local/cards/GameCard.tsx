import React from 'react';
import type { LocalGame } from '../../../lib/tauri';
import { IconMonitor } from '../ui/icons';
import type { CoverCache } from '../details/GameDetailPanel';
import { MediaCardShell } from './MediaCardShell';
import { getStatusBadge } from '../utils/statusBadge';

interface GameCardProps {
  game:       LocalGame;
  coverCache: CoverCache;
  onClick:    (game: LocalGame) => void;
  // The library status this install is tracked under (if any) — shown as
  // the same Pendiente/Completado/... badge LocalMediaCard already shows
  // for catalog entries, so a card reads the same status whether it's
  // sitting in its own status section or mixed into a launcher section
  // (Steam/Nintendo/...) alongside untracked and pending games.
  status?:    string | null;
}

export function GameCard({ game, coverCache, onClick, status }: GameCardProps) {
  const cover = (game.app_id ? coverCache[game.app_id]?.cover : undefined) ?? null;
  const badgeInfo = getStatusBadge(status);

  return (
    <MediaCardShell
      title={game.name}
      cover={cover}
      placeholderIcon={<IconMonitor />}
      badge={badgeInfo && (
        <span className={`local-media-status-badge local-media-status-badge--${badgeInfo.modifier}`}>
          {badgeInfo.label}
        </span>
      )}
      onClick={() => onClick(game)}
      lazyImage
    />
  );
}
