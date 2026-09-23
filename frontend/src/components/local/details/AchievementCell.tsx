import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { wrapAssetUrl, type SteamAchievement } from '../../../lib/tauri';
import { getT } from '../../../i18n/runtime';
import { formatDateShort } from '../../../lib/shared/text/format-date';

interface AchievementCellProps {
  ach:   SteamAchievement;
  // Kept as the cell's identity for callers; icons come from `ach` itself.
  appId: string;
}

const ICON_SIZE = 52;

// The downloaded icon (asset protocol: no IPC round trip, no base64) first,
// then the remote URL (Steam CDN / RetroAchievements), then the placeholder.
function iconCandidates(ach: SteamAchievement): string[] {
  const out: string[] = [];
  if (ach.icon_local) out.push(wrapAssetUrl(ach.icon_local));
  if (ach.icon) out.push(ach.icon);
  return out;
}

export function AchievementCell({ ach }: AchievementCellProps) {
  const t = getT();
  const isUnachievedSpoiler = !!ach.hidden && !ach.achieved;
  // Sources that failed to load, so the next candidate takes over.
  const [failed, setFailed] = useState<readonly string[]>([]);
  const src = iconCandidates(ach).find(candidate => !failed.includes(candidate)) ?? null;
  const cellRef = useRef<HTMLDivElement>(null);
  // Was a plain CSS :hover-shown absolutely-positioned child before — the
  // achievements grid sits inside .local-game-detail-content, which owns
  // its own overflow-y:auto (see local.css) to keep the banner from
  // resizing as content streams in. Any tooltip near the top/edge of that
  // scroll box got silently clipped by it, since overflow:hidden/auto on
  // an ancestor clips descendants regardless of z-index — z-index only
  // reorders what's already visible, it can't escape a clipping ancestor.
  // Rendering into a body-level portal with position:fixed, positioned
  // from the cell's own measured rect, is what actually escapes that.
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);

  const unlockDate = ach.achieved && ach.unlocktime > 0
    ? formatDateShort(new Date(ach.unlocktime * 1000))
    : null;

  function showTooltip() {
    const rect = cellRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Centered above the cell, clamped so it can't run off either edge of
    // the viewport for a cell sitting near the panel's own left/right edge.
    const TOOLTIP_WIDTH = 220;
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - TOOLTIP_WIDTH / 2, 8),
      window.innerWidth - TOOLTIP_WIDTH - 8,
    );
    setTooltipPos({ top: rect.top - 8, left });
  }

  return (
    <div
      ref={cellRef}
      className={`local-game-detail-ach-cell${ach.achieved ? ' achieved' : ''}${isUnachievedSpoiler ? ' spoiler' : ''}`}
      onMouseEnter={showTooltip}
      onMouseLeave={() => setTooltipPos(null)}
    >
      {src ? (
        <img
          src={src}
          alt={ach.name || ach.apiname}
          className="local-game-detail-ach-img"
          width={ICON_SIZE}
          height={ICON_SIZE}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(prev => prev.includes(src) ? prev : [...prev, src])}
        />
      ) : (
        <div className="local-game-detail-ach-img local-game-detail-ach-placeholder">
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
            <path d="M4 22h16"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
          </svg>
        </div>
      )}
      {isUnachievedSpoiler && <span className="local-game-detail-ach-spoiler-label">{t.local.spoiler_label}</span>}
      {tooltipPos && createPortal(
        <div
          className="local-game-detail-ach-tooltip local-game-detail-ach-tooltip--portal"
          style={{ top: tooltipPos.top, left: tooltipPos.left }}
        >
          {isUnachievedSpoiler && <span className="local-game-detail-ach-tooltip-spoiler">{t.local.spoiler_label}</span>}
          <span className="local-game-detail-ach-tooltip-name">{ach.name || ach.apiname}</span>
          {ach.description && <span className="local-game-detail-ach-tooltip-desc">{ach.description}</span>}
          {unlockDate && <span className="local-game-detail-ach-tooltip-date">{t.local.achievement_unlocked_on}: {unlockDate}</span>}
        </div>,
        document.body,
      )}
    </div>
  );
}
