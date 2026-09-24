import { useEffect, useRef, useState } from 'react';
import { isNightModeActive, nightModeStore, toggleNightMode } from '../../../lib/player/night-mode';
import type { PlayerStatus } from '../../../lib/player/player-status';
import { playerSetNightMode, type NightModeLevel } from '../../../lib/tauri/player';
import { useExternalStore } from '../../shared/hooks/useExternalStore';

export interface PlayerNightMode {
  /** The remembered choice (what the button shows as pressed). */
  enabled: boolean;
  /** The chain is filtering the audio right now (pill). */
  active: boolean;
  /** The bundled libmpv rejected every chain: the button is disabled. */
  unavailable: boolean;
  toggle: () => void;
}

// Applies the remembered night-mode choice to the engine. Mounted once, by
// the one controls surface (PlayerShell). It re-applies on every new file
// once playback has started — by then mpv's audio chain exists, so a
// filter the build lacks is rejected at once instead of breaking the audio
// init — and the engine leaves an already-active chain alone. A file with
// no audio answers `pending` and the next file tries again; `unavailable`
// sticks for the rest of the player's life.
export function usePlayerNightMode(status: PlayerStatus): PlayerNightMode {
  const enabled = useExternalStore(nightModeStore);
  const [level, setLevel] = useState<NightModeLevel>('off');
  const applied = useRef(false);
  const unavailable = useRef(false);
  const path = status.path;
  const ready = status.state !== 'idle' && status.position_secs > 0;

  useEffect(() => {
    if (!ready || !path) return;
    if (!enabled && !applied.current) return;
    if (enabled && unavailable.current) return;
    playerSetNightMode(enabled)
      .then(next => {
        applied.current = isNightModeActive(next);
        if (next === 'unavailable') unavailable.current = true;
        setLevel(next);
      })
      .catch(err => console.error('Night mode failed', err));
  }, [enabled, path, ready]);

  return {
    enabled,
    active: enabled && isNightModeActive(level),
    unavailable: level === 'unavailable',
    toggle: toggleNightMode,
  };
}
