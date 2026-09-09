import React from 'react';
import type { LocalGame } from '../../../lib/tauri';
import { IconMonitor } from '../ui/icons';
import type { CoverCache } from '../details/GameDetailPanel';
import { MediaCardShell } from './MediaCardShell';

interface GameCardProps {
  game:       LocalGame;
  coverCache: CoverCache;
  onClick:    (game: LocalGame) => void;
}

export function GameCard({ game, coverCache, onClick }: GameCardProps) {
  const cover = (game.app_id ? coverCache[game.app_id]?.cover : undefined) ?? null;

  return (
    <MediaCardShell
      title={game.name}
      cover={cover}
      placeholderIcon={<IconMonitor />}
      onClick={() => onClick(game)}
      lazyImage
    />
  );
}
