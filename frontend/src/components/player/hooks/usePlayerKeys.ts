import { useEffect, useMemo, useRef } from 'react';
import { bindingAction, PLAYER_KEY_BINDINGS, resolvePlayerKeyAction } from '../../../lib/player/keymap';
import type { ShortcutBinding } from '../../../lib/shared/keyboard/shortcut-registry';
import { useShortcuts } from '../../shared/hooks/useShortcuts';
import { runPlayerAction, type PlayerActionContext } from '../player-actions';

// The player's keys, registered in the app-wide shortcut registry under the
// `player` context (top priority, so the media page's f/p/digits never fire
// while the player is open, and the `?` sheet lists them). The context is
// read through a ref so handlers always see the latest status without the
// registration churning on every status tick. `enabled=false` skips binding
// (docked shell: the stage already owns the keys of that window).
//
// Escape is the one key kept on a private listener: ModalShell owns Escape
// in the registry, and the player's Escape ladder (menus → fullscreen →
// close) predates it (PlayerModal runs with closeOnEscape=false).
const ESCAPE_BINDING_ID = 'player.escape';

export function usePlayerKeys(context: PlayerActionContext, enabled = true) {
  const latest = useRef(context);
  useEffect(() => {
    latest.current = context;
  });

  const bindings = useMemo<ShortcutBinding[]>(() => PLAYER_KEY_BINDINGS
    .filter(binding => binding.id !== ESCAPE_BINDING_ID)
    .map(binding => ({
      id: binding.id,
      keys: binding.keys,
      description: binding.description,
      allowInInputs: binding.allowInInputs,
      handler: event => runPlayerAction(bindingAction(binding, event.key), latest.current),
    })), []);
  useShortcuts('player', bindings, { enabled });

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const action = resolvePlayerKeyAction(event);
      if (!action || action.type !== 'escape') return;
      event.preventDefault();
      runPlayerAction(action, latest.current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
