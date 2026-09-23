import { useEffect, useRef } from 'react';
import { resolvePlayerKeyAction } from '../../../lib/player/keymap';
import { runPlayerAction, type PlayerActionContext } from '../player-actions';

// Window-level shortcuts. The context is read through a ref so the listener
// is registered once and always sees the latest status without re-binding
// on every status tick. `enabled=false` skips binding (docked shell: the
// stage already owns the keys of that window).
export function usePlayerKeys(context: PlayerActionContext, enabled = true) {
  const latest = useRef(context);
  useEffect(() => {
    latest.current = context;
  });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Typing into a range/select must keep its native keys.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) {
        if (event.key !== 'Escape' && event.key !== 'F12' && event.key !== ' ') return;
      }
      const action = resolvePlayerKeyAction(event);
      if (!action) return;
      event.preventDefault();
      runPlayerAction(action, latest.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
