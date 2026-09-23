import { useCallback, useEffect, useRef, useState } from 'react';
import { getT } from '../../i18n/runtime';
import { closePlayerModal } from '../../lib/player/player-modal-state';
import { getControlsMode } from '../../lib/player/player-settings';
import { listenPlayerEnded, playerFocusOverlay, playerIsFullscreen, playerStopClose } from '../../lib/tauri/player';
import { PlayerShell } from './PlayerShell';
import { usePlayerKeys } from './hooks/usePlayerKeys';
import { usePlayerStatus } from './hooks/usePlayerStatus';
import { useMediaRemote } from '../shared/hooks/useMediaRemote';
import { playerRemoteAction } from '../../lib/big-picture/media-remote';
import { runPlayerAction, type PlayerActionContext } from './player-actions';
import { useVideoBounds } from './hooks/useVideoBounds';

const FULLSCREEN_CLASS = 'player-fullscreen';
const PLAYER_OPEN_CLASS = 'player-open';

// Body of the player modal. The native mpv surface is placed over
// `.player-stage__video` (see useVideoBounds); playback lives only while
// this is mounted — unmounting (modal closed, reload) closes the engine.
// Exactly one controls surface exists at a time: the owned overlay window
// in `overlay` mode, or the docked PlayerShell rendered here in `docked`.
export function PlayerStage() {
  const t = getT().player;
  const { status } = usePlayerStatus();
  const [fullscreen, setFullscreen] = useState(false);
  const [docked] = useState(() => getControlsMode() === 'docked');
  const videoRef = useRef<HTMLDivElement | null>(null);
  useVideoBounds(videoRef);

  // Fullscreen is toggled on the main window (from either surface); mirror
  // it into an <html> class so the page behind cannot scroll.
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      playerIsFullscreen().then(next => { if (!disposed) setFullscreen(next); }).catch(() => {});
    };
    refresh();
    window.addEventListener('resize', refresh);
    return () => {
      disposed = true;
      window.removeEventListener('resize', refresh);
    };
  }, []);

  // While the player is open the page behind must not scroll or keep its
  // scrollbar gutter (html has `scrollbar-gutter: stable`), which otherwise
  // shows as a black strip down the right edge of the video.
  useEffect(() => {
    document.documentElement.classList.add(PLAYER_OPEN_CLASS);
    return () => document.documentElement.classList.remove(PLAYER_OPEN_CLASS);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle(FULLSCREEN_CLASS, fullscreen);
    return () => document.documentElement.classList.remove(FULLSCREEN_CLASS);
  }, [fullscreen]);

  // Unmount (modal closed by any path) and page unload both stop the engine.
  useEffect(() => {
    const stop = () => { playerStopClose('navigate').catch(() => {}); };
    window.addEventListener('beforeunload', stop);
    return () => {
      window.removeEventListener('beforeunload', stop);
      stop();
    };
  }, []);

  // The engine ending for any reason (close button in either surface, the
  // main window closing, Esc) takes the modal down with it.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    listenPlayerEnded(() => closePlayerModal())
      .then(fn => { if (disposed) fn(); else unlisten = fn; })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Docked mode: the shell below owns the skip segments but this window
  // owns the keys, so the shell hands its skip action up through a ref.
  const skipRef = useRef<() => void>(() => {});
  const onSkipReady = useCallback((skip: () => void) => { skipRef.current = skip; }, []);

  const noop = () => false;
  const actionContext: PlayerActionContext = {
    status, isFullscreen: fullscreen, setFullscreen, toggleQueue: () => {}, dismissOverlays: noop, skipSegment: () => skipRef.current(),
  };
  usePlayerKeys(actionContext);
  // Big Picture's gamepad, through the same actions as the keys. B closes
  // the player outright (not Escape's fullscreen-first ladder: Big Picture
  // keeps the window fullscreen underneath).
  useMediaRemote(command => {
    const action = playerRemoteAction(command);
    if (action.type === 'close') playerStopClose('stopped').catch(() => {});
    else runPlayerAction(action, actionContext);
  });

  return (
    <div className={`player-stage${docked ? ' player-stage--docked' : ''}${fullscreen ? ' player-stage--fullscreen' : ''}`}>
      <div
        ref={videoRef}
        className="player-stage__video"
        onClick={() => { if (!docked) playerFocusOverlay().catch(() => {}); }}
      >
        {status.state === 'idle' && <p className="player-stage__loading">{t.state_loading}</p>}
      </div>
      {docked && <PlayerShell docked onSkipReady={onSkipReady} />}
    </div>
  );
}
