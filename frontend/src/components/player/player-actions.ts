// Turns a resolved keyboard action (lib/player/keymap) or a button press
// into the matching engine command. Shared by the overlay and the stage
// page so both windows react to the same keys.

import { clampSpeed, SEEK_END_MARGIN_SECONDS, type PlayerKeyAction } from '../../lib/player/keymap';
import type { PlayerStatus } from '../../lib/player/player-status';
import { toggleNightMode } from '../../lib/player/night-mode';
import { markManualCycle } from '../../lib/player/track-memory';
import {
  playerCycleTrack, playerFrameStep, playerNext, playerPrev, playerScreenshot, playerSeek, playerSetFullscreen, playerSetMute,
  playerSetSpeed, playerSetSubDelay, playerSetVolume, playerStopClose, playerTogglePause,
} from '../../lib/tauri/player';

// Slower only: nothing above 1× is offered (lib/player/keymap SPEED_MAX).
export const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1] as const;
export const MAX_VOLUME = 130;

export interface PlayerActionContext {
  status: PlayerStatus;
  isFullscreen: boolean;
  setFullscreen: (next: boolean) => void;
  toggleQueue: () => void;
  // Escape: closes whatever is open; returns true when something was closed
  // so fullscreen is only left when nothing else needed dismissing.
  dismissOverlays: () => boolean;
  // S: seeks past the opening/ending the position is inside, if any
  // (usePlayerSkipSegments); a no-op when nothing is active.
  skipSegment: () => void;
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
    case 'skip_segment':
      context.skipSegment();
      break;
    case 'frame_step':
      swallow(playerFrameStep(action.direction));
      break;
    case 'speed_delta':
      swallow(playerSetSpeed(clampSpeed(status.speed + action.delta)));
      break;
    case 'toggle_night_mode':
      // Only the preference flips here: the controls surface applies it
      // (usePlayerNightMode), whichever window the key landed in.
      toggleNightMode();
      break;
    case 'cycle_track':
      // A hand-picked track: remembered for the series (track-memory).
      markManualCycle(action.kind);
      swallow(playerCycleTrack(action.kind));
      break;
    case 'seek_fraction':
      if (status.duration_secs > 0) swallow(playerSeek(status.duration_secs * action.fraction, false));
      break;
    case 'seek_start':
      swallow(playerSeek(0, false));
      break;
    case 'seek_end':
      if (status.duration_secs > 0) swallow(playerSeek(Math.max(0, status.duration_secs - SEEK_END_MARGIN_SECONDS), false));
      break;
  }
}

export function applySpeed(speed: number) {
  swallow(playerSetSpeed(clampSpeed(speed)));
}
