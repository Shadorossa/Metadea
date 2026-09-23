// Turns a resolved keyboard action (lib/player/keymap) or a button press
// into the matching engine command. Shared by the overlay and the stage
// page so both windows react to the same keys.

import type { PlayerKeyAction } from '../../lib/player/keymap';
import type { PlayerStatus } from '../../lib/player/player-status';
import {
  playerNext, playerPrev, playerScreenshot, playerSeek, playerSetFullscreen, playerSetMute, playerSetSpeed, playerSetSubDelay,
  playerSetVolume, playerStopClose, playerTogglePause,
} from '../../lib/tauri/player';

export const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const MAX_VOLUME = 130;

export interface PlayerActionContext {
  status: PlayerStatus;
  isFullscreen: boolean;
  setFullscreen: (next: boolean) => void;
  toggleQueue: () => void;
  // Escape: closes whatever is open; returns true when something was closed
  // so fullscreen is only left when nothing else needed dismissing.
  dismissOverlays: () => boolean;
}

function swallow(promise: Promise<unknown>) {
  promise.catch(err => console.error('Player command failed', err));
}

export function setFullscreen(next: boolean, context: Pick<PlayerActionContext, 'setFullscreen'>) {
  context.setFullscreen(next);
  swallow(playerSetFullscreen(next));
}

export function runPlayerAction(action: PlayerKeyAction, context: PlayerActionContext): void {
  const { status } = context;
  switch (action.type) {
    case 'toggle_pause':
      swallow(playerTogglePause());
      break;
    case 'seek':
      swallow(playerSeek(action.seconds, true));
      break;
    case 'volume': {
      const next = Math.min(MAX_VOLUME, Math.max(0, Math.round(status.volume + action.delta)));
      swallow(playerSetVolume(next));
      if (status.muted && action.delta > 0) swallow(playerSetMute(false));
      break;
    }
    case 'toggle_mute':
      swallow(playerSetMute(!status.muted));
      break;
    case 'toggle_fullscreen':
      setFullscreen(!context.isFullscreen, context);
      break;
    case 'escape':
      // Menus/queue first, then fullscreen, then the player itself — the
      // same layering the reader's Esc follows.
      if (context.dismissOverlays()) break;
      if (context.isFullscreen) { setFullscreen(false, context); break; }
      swallow(playerStopClose('stopped'));
      break;
    case 'next':
      swallow(playerNext());
      break;
    case 'prev':
      swallow(playerPrev());
      break;
    case 'screenshot':
      swallow(playerScreenshot());
      break;
    case 'sub_delay':
      swallow(playerSetSubDelay(Math.round((status.sub_delay_secs + action.delta) * 1000) / 1000));
      break;
    case 'toggle_queue':
      context.toggleQueue();
      break;
  }
}

export function applySpeed(speed: number) {
  swallow(playerSetSpeed(speed));
}
