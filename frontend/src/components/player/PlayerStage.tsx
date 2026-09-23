import { useEffect, useRef, useState } from 'react';
import { getT } from '../../i18n/runtime';
import { closePlayerModal } from '../../lib/player/player-modal-state';
import { getControlsMode } from '../../lib/player/player-settings';
import { listenPlayerEnded, playerFocusOverlay, playerIsFullscreen, playerStopClose } from '../../lib/tauri/player';
import { PlayerShell } from './PlayerShell';
import { usePlayerKeys } from './hooks/usePlayerKeys';
import { usePlayerStatus } from './hooks/usePlayerStatus';
import { useVideoBounds } from './hooks/useVideoBounds';

const FULLSCREEN_CLASS = 'player-fullscreen';

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

  const noop = () => false;
  usePlayerKeys({ status, isFullscreen: fullscreen, setFullscreen, toggleQueue: () => {}, dismissOverlays: noop });

  return (
    <div className={`player-stage${docked ? ' player-stage--docked' : ''}${fullscreen ? ' player-stage--fullscreen' : ''}`}>
      <div
        ref={videoRef}
        className="player-stage__video"
        onClick={() => { if (!docked) playerFocusOverlay().catch(() => {}); }}
      >
        {status.state === 'idle' && <p className="player-stage__loading">{t.state_loading}</p>}
      </div>
      {docked && <PlayerShell docked />}
    </div>
  );
}
