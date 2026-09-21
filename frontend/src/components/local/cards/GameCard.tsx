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
  // Right-click "Eliminar de la lista" — offered on any card, installed or
  // not, cover or no cover, regardless of launcher. A real install just
  // re-scans back on the next scan (see remove_local_game's own doc
  // comment), but the delete option itself shouldn't be limited to
  // ghost/stale/cover-less entries — the user should be able to remove any
  // game they see here.
  onRequestDelete?: (game: LocalGame, x: number, y: number) => void;
  // The linked catalog entry's own title, when there is one — takes over
  // from game.name (the raw scanned name, which for a ROM is often a messy
  // dump filename) once a catalog link exists. See GamesGrid's
  // displayNameFor.
  displayName?: string;
}

export function GameCard({ game, coverCache, onClick, status, onRequestDelete, displayName }: GameCardProps) {
  const cover = (game.app_id ? coverCache[game.app_id]?.cover : undefined) ?? null;
  const badgeInfo = getStatusBadge(status);

  return (
    <MediaCardShell
      title={displayName ?? game.name}
      cover={cover}
      placeholderIcon={<IconMonitor />}
      badge={badgeInfo && (
        <span className={`local-media-status-badge local-media-status-badge--${badgeInfo.modifier}`}>
          {badgeInfo.label}
        </span>
      )}
      onClick={() => onClick(game)}
      selectionKey={game.external_id ?? game.app_id ?? game.name}
      onContextMenu={onRequestDelete ? e => {
        e.preventDefault();
        onRequestDelete(game, e.clientX, e.clientY);
      } : undefined}
      lazyImage
    />
  );
}
