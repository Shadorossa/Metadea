import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { getT } from '../../i18n/runtime';
import { formatCaptureTimecode } from '../../lib/player/player-status';
import { queueEntryHeading } from '../../lib/player/queue';
import { playerIsFullscreen, playerStopClose, playerTogglePause } from '../../lib/tauri/player';
import { PlayerControls, type PlayerMenuKind } from './PlayerControls';
import { PlayerQueuePanel } from './PlayerQueuePanel';
import { useAutoHide } from './hooks/useAutoHide';
import { usePlayerKeys } from './hooks/usePlayerKeys';
import { usePlayerStatus } from './hooks/usePlayerStatus';
import { setFullscreen as applyFullscreen } from './player-actions';

const IDLE_HIDE_MS = 2500;
const SCREENSHOT_TOAST_MS = 2600;

interface Props {
  // Docked: rendered by PlayerStage in the main WebView under the video
  // (no overlay window); always visible, keys are bound by the stage.
  docked?: boolean;
}

// Every control the user sees. Overlay mode: root of the transparent
// `player-overlay` window that floats over the video rect
// (src-tauri/src/player/window.rs). Docked mode: a plain bar below it.
export function PlayerShell({ docked = false }: Props) {
  const t = getT().player;
  const { status, session, screenshot, errorCode, dismissScreenshot, dismissError } = usePlayerStatus();
  const [queueOpen, setQueueOpen] = useState(false);
  const [menu, setMenu] = useState<PlayerMenuKind | null>(null);
  const [fullscreen, setFullscreenState] = useState(false);

  const pinned = docked || status.state !== 'playing' || queueOpen || menu !== null;
  const { visible } = useAutoHide(IDLE_HIDE_MS, pinned);

  useEffect(() => {
    playerIsFullscreen().then(setFullscreenState).catch(() => {});
  }, []);

  useEffect(() => {
    if (!screenshot) return;
    const timer = window.setTimeout(dismissScreenshot, SCREENSHOT_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [screenshot, dismissScreenshot]);

  const toggleQueue = () => setQueueOpen(open => !open);
  const dismissOverlays = () => {
    if (menu !== null) { setMenu(null); return true; }
    if (queueOpen) { setQueueOpen(false); return true; }
    return false;
  };

  const actionContext = { status, isFullscreen: fullscreen, setFullscreen: setFullscreenState, toggleQueue, dismissOverlays };
  usePlayerKeys(actionContext, !docked);

  const toggleFullscreen = () => applyFullscreen(!fullscreen, actionContext);
  const index = Math.max(0, status.playlist_index);
  const heading = session ? queueEntryHeading(session.work_name, index, session.titles, session.episode_labels) : '';
  const errorText = errorCode === 'load_failed' ? t.error_load_failed : errorCode ? t.error_generic.replace('{code}', errorCode) : null;

  return (
    <div className={`player-overlay${visible ? '' : ' player-overlay--idle'}${queueOpen ? ' player-overlay--queue' : ''}${docked ? ' player-overlay--docked' : ''}`}>
      {!docked && (
        <button
          type="button"
          className="player-overlay__stage"
          aria-label={status.state === 'playing' ? t.pause : t.play}
          onClick={() => playerTogglePause().catch(() => {})}
          onDoubleClick={toggleFullscreen}
        />
      )}

      <header className="player-overlay__top">
        <h1 className="player-overlay__heading">{heading}</h1>
        <button type="button" className="player-icon-btn" onClick={() => playerStopClose('stopped').catch(() => {})} aria-label={t.close} title={t.close}>
          <X size={18} />
        </button>
      </header>

      {status.state === 'ended' && <div className="player-overlay__ended" role="status">{t.state_ended}</div>}

      <div className="player-overlay__bottom">
        <PlayerControls
          status={status}
          t={t}
          isFullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          menu={menu}
          onMenuChange={setMenu}
          queueOpen={queueOpen}
          onToggleQueue={toggleQueue}
        />
      </div>

      {queueOpen && session && (
        <PlayerQueuePanel session={session} currentIndex={index} onClose={() => setQueueOpen(false)} t={t} />
      )}

      {screenshot && (
        <div className="player-toast" role="status" aria-live="polite">
          <strong>{t.screenshot_saved}</strong>
          <span>{screenshot.episode_label} · {formatCaptureTimecode(screenshot.timecode)}</span>
        </div>
      )}
      {errorText && (
        <div className="player-toast player-toast--error" role="alert">
          <span>{errorText}</span>
          <button type="button" className="player-icon-btn" onClick={dismissError} aria-label={t.dismiss} title={t.dismiss}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
