import { useEffect, useRef } from 'react';
import { registerMediaRemote, type MediaRemoteHandler } from '../../../lib/big-picture/media-remote';

// Registers this surface (player, reader) as the target of Big Picture's
// gamepad while mounted. The handler is read through a ref, so callers can
// pass a fresh closure each render without re-registering.
export function useMediaRemote(handler: MediaRemoteHandler, enabled = true): void {
  const latest = useRef(handler);
  useEffect(() => { latest.current = handler; });
  useEffect(() => {
    if (!enabled) return;
    return registerMediaRemote(command => latest.current(command));
  }, [enabled]);
}
