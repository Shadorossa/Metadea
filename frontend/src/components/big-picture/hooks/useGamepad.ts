import { useEffect, useRef } from 'react';
import {
  createGamepadLoop, readNavigatorGamepads, hasConnectedGamepad,
  type BigPictureAction, type ConnectedPad,
} from '../../../lib/big-picture/gamepad';

// Guide watcher tick while Big Picture is closed — slow on purpose; it only
// has to notice a held Start+Select or a Guide press.
const IDLE_POLL_MS = 100;

interface LoopHandlers {
  onActions: (actions: BigPictureAction[], pad: ConnectedPad) => void;
  onPadsChanged?: (pads: ConnectedPad[]) => void;
}

/** Polls the gamepads every animation frame while `enabled` (Big Picture
 *  open); nothing runs otherwise. Handlers are read through a ref. */
export function useGamepadFrameLoop(enabled: boolean, handlers: LoopHandlers): void {
  const latest = useRef(handlers);
  useEffect(() => { latest.current = handlers; });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const loop = createGamepadLoop({
      getGamepads: readNavigatorGamepads,
      onActions: (actions, pad) => latest.current.onActions(actions, pad),
      onPadsChanged: pads => latest.current.onPadsChanged?.(pads),
      schedule: tick => window.requestAnimationFrame(tick),
      cancel: handle => window.cancelAnimationFrame(handle),
      now: () => performance.now(),
    });
    loop.start();
    return () => loop.stop();
  }, [enabled]);
}

/** While `enabled` (Big Picture closed) and a pad is connected, watches for
 *  the Guide button / held Start+Select at a low rate and calls `onGuide`.
 *  Browsers only announce a pad after its first button press, so the timer
 *  starts on `gamepadconnected` and stops once the last pad leaves. */
export function useGamepadGuideWatcher(enabled: boolean, onGuide: () => void): void {
  const latest = useRef(onGuide);
  useEffect(() => { latest.current = onGuide; });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    const loop = createGamepadLoop({
      getGamepads: readNavigatorGamepads,
      // Only while Metadea is in front — not from inside a launched game.
      onActions: actions => { if (actions.includes('guide') && document.hasFocus()) latest.current(); },
      schedule: tick => window.setTimeout(tick, IDLE_POLL_MS),
      cancel: handle => window.clearTimeout(handle),
      now: () => performance.now(),
    });
    const sync = () => {
      if (hasConnectedGamepad()) loop.start();
      else loop.stop();
    };
    sync();
    window.addEventListener('gamepadconnected', sync);
    window.addEventListener('gamepaddisconnected', sync);
    return () => {
      window.removeEventListener('gamepadconnected', sync);
      window.removeEventListener('gamepaddisconnected', sync);
      loop.stop();
    };
  }, [enabled]);
}
