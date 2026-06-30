import React, { useState, useEffect } from 'react';
import { pathToDataUrl, type LocalGame, type MetaEntry } from '../../../lib/tauri';
import { IconMonitor } from '../ui/icons';
import type { CoverCache } from '../details/GameDetailPanel';

interface GameCardProps {
  game:       LocalGame;
  pathCache:  Record<string, MetaEntry>;
  coverCache: CoverCache;
  onClick:    (game: LocalGame) => void;
}

export function GameCard({ game, pathCache, coverCache, onClick }: GameCardProps) {
  const [cover, setCover] = useState<string | null>(null);

  const pathEntry   = game.app_id ? pathCache[game.app_id]   : undefined;
  const cachedEntry = game.app_id ? coverCache[game.app_id]  : undefined;

  useEffect(() => {
    if (cachedEntry?.cover) {
      setCover(cachedEntry.cover);
    } else if (pathEntry?.cover_path) {
      pathToDataUrl(pathEntry.cover_path).then(setCover);
    }
  }, [cachedEntry, pathEntry]);

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
          ? <img src={cover} alt={game.name} loading="lazy" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          : <div className="local-game-cover-placeholder"><IconMonitor /></div>
        }
      </div>
      <p className="local-game-name">{game.name}</p>
    </div>
  );
}
