import { useCallback, useEffect, useState } from 'react';
import {
  listenPlayerError, listenPlayerScreenshot, listenPlayerSession, listenPlayerStatus, playerGetSession, playerGetStatus, type Unlisten,
} from '../../../lib/tauri/player';
import {
  EMPTY_PLAYER_STATUS, type PlayerScreenshotSaved, type PlayerSessionInfo, type PlayerStatus,
} from '../../../lib/player/player-status';

// The overlay's view of the engine: one snapshot on mount (a window that
// opens after the last event went out would otherwise sit on defaults),
// then live `player://*` events.
export function usePlayerStatus() {
  const [status, setStatus] = useState<PlayerStatus>(EMPTY_PLAYER_STATUS);
  const [session, setSession] = useState<PlayerSessionInfo | null>(null);
  const [screenshot, setScreenshot] = useState<PlayerScreenshotSaved | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Unlisten[] = [];
    const keep = (promise: Promise<Unlisten>) => {
      promise.then(unlisten => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      }).catch(err => console.error('Player event subscription failed', err));
    };
    keep(listenPlayerStatus(next => setStatus(next)));
    keep(listenPlayerSession(next => setSession(next)));
    keep(listenPlayerScreenshot(next => setScreenshot(next)));
    keep(listenPlayerError(next => setErrorCode(next.code)));
    playerGetStatus().then(next => { if (!disposed && next) setStatus(next); });
    playerGetSession().then(next => { if (!disposed && next) setSession(next); });
    return () => {
      disposed = true;
      unlisteners.forEach(unlisten => unlisten());
    };
  }, []);

  const dismissScreenshot = useCallback(() => setScreenshot(null), []);
  const dismissError = useCallback(() => setErrorCode(null), []);

  return { status, session, screenshot, errorCode, dismissScreenshot, dismissError };
}
