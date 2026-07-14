import React, { useState, useEffect } from 'react';
import {
  readGameInfo, steamGetPlayerAchievements, launchGame,
  type LocalGame, type GameInfo, type SteamAchievement,
  updateDiscordPresence, resetDiscordPresence,
} from '../../../lib/tauri';
import { AchievementCell } from './AchievementCell';
import { IgdbPickerModal } from '../modals/IgdbPickerModal';
import { IconX, IconMonitor } from '../ui/icons';
import { formatPlaytime, formatLastPlayed, formatDate } from '../utils/formatters';

export type CoverCache = Record<string, { cover?: string; banner?: string }>;

interface GameDetailPanelProps {
  game:           LocalGame;
  coverCache:     CoverCache;
  onClose:        () => void;
  onMetaRefresh?: () => void;
}

export function GameDetailPanel({ game, coverCache, onClose, onMetaRefresh }: GameDetailPanelProps) {
  const [gameInfo,      setGameInfo]      = useState<GameInfo | null>(null);
  const [achievements,  setAchievements]  = useState<{ unlocked: number; total: number; list: SteamAchievement[] } | null>(null);
  const [showPicker,    setShowPicker]    = useState(false);
  const [hasLaunched,   setHasLaunched]   = useState(false);

  useEffect(() => {
    return () => {
      if (hasLaunched) {
        resetDiscordPresence().catch(() => {});
      }
    };
  }, [hasLaunched]);

  useEffect(() => {
    if (!game.app_id) return;
    readGameInfo(game.app_id).then(setGameInfo);
  }, [game.app_id]);

  useEffect(() => {
    if (game.launcher !== 'steam' || !game.app_id) { setAchievements(null); return; }
    steamGetPlayerAchievements(Number(game.app_id)).then(res => setAchievements(res || null));
  }, [game.app_id, game.launcher]);

  const entry      = game.app_id ? coverCache[game.app_id] : undefined;
  const banner     = entry?.banner ?? entry?.cover ?? null;
  const metaDots   = [formatDate(gameInfo?.release_date ?? undefined), gameInfo?.genres?.join(', ')].filter(Boolean).join('  ·  ');

  return (
    <div className="local-game-detail-panel">
      <div className="local-game-detail-header">
        {banner ? (
          <img src={banner} alt={game.name} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-elevated)' }}>
            <IconMonitor />
          </div>
        )}
        <div className="local-game-detail-backdrop" />
        {game.launcher === 'steam' && game.app_id && (
          <button className="local-game-detail-edit" onClick={() => setShowPicker(true)} title="Cambiar juego en IGDB">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        )}
        <button className="local-game-detail-close" onClick={onClose}><IconX /></button>
      </div>

      {showPicker && (
        <IgdbPickerModal
          game={game}
          onClose={() => setShowPicker(false)}
          onPicked={() => onMetaRefresh?.()}
        />
      )}

      <div className="local-game-detail-content">
        <div className="local-game-detail-title-block">
          <p className="local-game-detail-title">{game.name}</p>
          {gameInfo?.developers && gameInfo.developers.length > 0 && (
            <p className="local-game-detail-by">by {gameInfo.developers.join(', ')}</p>
          )}
        </div>

        <div className="local-game-detail-bottom">
          <button className="local-game-detail-play" onClick={() => {
            launchGame(game.launcher, game.app_id, game.install_path)
              .then(() => {
                setHasLaunched(true);
                const startTime = Math.floor(Date.now() / 1000);
                const coverUrl = banner && banner.startsWith('http') ? banner : undefined;
                updateDiscordPresence(`Playing ${game.name}`, "", startTime, undefined, coverUrl, game.name, "metadea", "Metadea").catch(() => {});
              })
              .catch(console.error);
          }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Jugar
          </button>

          <div className="local-game-detail-stats">
            <div className="local-game-detail-stat">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              <span>{formatPlaytime(game.playtime_minutes)}</span>
              <span className="local-game-detail-stat-label">Tiempo</span>
            </div>
            <div className="local-game-detail-stat">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              <span>{formatLastPlayed(game.last_played)}</span>
              <span className="local-game-detail-stat-label">Última vez</span>
            </div>
            <div className="local-game-detail-stat">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/>
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
              </svg>
              <span>{achievements ? `${achievements.unlocked}/${achievements.total}` : '—'}</span>
              <span className="local-game-detail-stat-label">Logros</span>
            </div>
          </div>

          {gameInfo?.igdb_id && (
            <a href={`/media?id=game:${gameInfo.igdb_id}`} className="local-game-detail-catalog-link">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              Ver en catálogo
            </a>
          )}
        </div>

        {metaDots && <p className="local-game-detail-metadots">{metaDots}</p>}
        {gameInfo?.summary && <p className="local-game-detail-summary">{gameInfo.summary}</p>}

        {achievements?.list && achievements.list.length > 0 && (
          <div className="local-game-detail-achievements">
            <p className="local-game-detail-achievements-title">
              Logros — {achievements.unlocked}/{achievements.total}
            </p>
            <div className="local-game-detail-achievement-grid">
              {achievements.list.map((ach: SteamAchievement) => (
                <AchievementCell key={ach.apiname} ach={ach} appId={game.app_id!} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
