import React, { useState, useEffect } from 'react';
import { steamAchievementIcon, type SteamAchievement } from '../../../lib/tauri';
import { formatDateShort } from '../../../lib/shared/formatDate';

interface AchievementCellProps {
  ach:   SteamAchievement;
  appId: string;
}

export function AchievementCell({ ach, appId }: AchievementCellProps) {
  const localFile = ach.achieved ? ach.icon_unlocked : ach.icon_locked;
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (localFile) {
      steamAchievementIcon(appId, localFile).then(url => setSrc(url ?? ach.icon ?? null));
    } else {
      setSrc(ach.icon ?? null);
    }
  }, [appId, localFile, ach.icon]);

  const unlockDate = ach.achieved && ach.unlocktime > 0
    ? formatDateShort(new Date(ach.unlocktime * 1000))
    : null;

  return (
    <div className={`local-game-detail-ach-cell${ach.achieved ? ' achieved' : ''}`}>
      {src ? (
        <img src={src} alt={ach.name || ach.apiname} className="local-game-detail-ach-img" />
      ) : (
        <div className="local-game-detail-ach-img local-game-detail-ach-placeholder">
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
            <path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
          </svg>
        </div>
      )}
      <div className="local-game-detail-ach-tooltip">
        <span className="local-game-detail-ach-tooltip-name">{ach.name || ach.apiname}</span>
        {ach.description && <span className="local-game-detail-ach-tooltip-desc">{ach.description}</span>}
        {unlockDate && <span className="local-game-detail-ach-tooltip-date">Desbloqueado: {unlockDate}</span>}
      </div>
    </div>
  );
}
