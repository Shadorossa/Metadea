// Lets Big Picture's gamepad drive whatever full-screen media surface is
// open on top of it — the built-in player or a reader. Each surface
// registers a handler that maps a remote command onto its OWN existing
// actions (runPlayerAction, the reader's page turns and close) while it is
// mounted; the most recently registered one receives the commands.
import { createExternalStore } from '../shared/state/external-store';
import { SEEK_BUTTON_STEP_SECONDS, VOLUME_STEP, type PlayerKeyAction } from '../player/keymap';

export type MediaRemoteCommand =
  | 'confirm' | 'back'
  | 'up' | 'down' | 'left' | 'right'
  | 'prev' | 'next';

export type MediaRemoteHandler = (command: MediaRemoteCommand) => void;

const handlers: MediaRemoteHandler[] = [];

/** How many surfaces are registered — Big Picture re-applies its own
 *  fullscreen when this drops back to zero (a reader's Escape leaves it). */
export const mediaRemoteCountStore = createExternalStore<number>(0);

export function registerMediaRemote(handler: MediaRemoteHandler): () => void {
  handlers.push(handler);
  mediaRemoteCountStore.set(handlers.length);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index === -1) return;
    handlers.splice(index, 1);
    mediaRemoteCountStore.set(handlers.length);
  };
}

export function hasMediaRemote(): boolean {
  return handlers.length > 0;
}

/** Sends `command` to the topmost surface; false when none is open. */
export function sendMediaRemote(command: MediaRemoteCommand): boolean {
  const handler = handlers[handlers.length - 1];
  if (!handler) return false;
  handler(command);
  return true;
}

/** The built-in player's reading of a remote command: A play/pause, LB/RB
 *  previous/next episode, left/right seek, up/down volume, B close. */
export function playerRemoteAction(command: MediaRemoteCommand): PlayerKeyAction | { type: 'close' } {
  switch (command) {
    case 'confirm': return { type: 'toggle_pause' };
    case 'back': return { type: 'close' };
    case 'left': return { type: 'seek', seconds: -SEEK_BUTTON_STEP_SECONDS };
    case 'right': return { type: 'seek', seconds: SEEK_BUTTON_STEP_SECONDS };
    case 'up': return { type: 'volume', delta: VOLUME_STEP };
    case 'down': return { type: 'volume', delta: -VOLUME_STEP };
    case 'prev': return { type: 'prev' };
    case 'next': return { type: 'next' };
  }
}

/** A reader's reading: D-pad (and A) turn pages, LB/RB jump chapters where
 *  the reader has them, B closes. */
export function readerRemoteAction(command: MediaRemoteCommand): 'page_prev' | 'page_next' | 'chapter_prev' | 'chapter_next' | 'close' {
  switch (command) {
    case 'back': return 'close';
    case 'left': case 'up': return 'page_prev';
    case 'right': case 'down': case 'confirm': return 'page_next';
    case 'prev': return 'chapter_prev';
    case 'next': return 'chapter_next';
  }
}
