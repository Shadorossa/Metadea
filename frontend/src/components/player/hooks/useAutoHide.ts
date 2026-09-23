import { useCallback, useEffect, useRef, useState } from 'react';

// Controls (and the cursor, via CSS) disappear after `idleMs` without
// pointer/keyboard activity. `pinned` (paused, a menu or the queue open)
// forces them on screen without touching the idle timer.
export function useAutoHide(idleMs: number, pinned: boolean) {
  const [idle, setIdle] = useState(false);
  const timer = useRef<number | null>(null);

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setIdle(true), idleMs);
  }, [idleMs]);

  const poke = useCallback(() => {
    setIdle(false);
    schedule();
  }, [schedule]);

  useEffect(() => {
    schedule();
    window.addEventListener('mousemove', poke);
    window.addEventListener('mousedown', poke);
    window.addEventListener('keydown', poke);
    return () => {
      window.removeEventListener('mousemove', poke);
      window.removeEventListener('mousedown', poke);
      window.removeEventListener('keydown', poke);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [poke, schedule]);

  return { visible: pinned || !idle, poke };
}
