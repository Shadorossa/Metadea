// Keyboard shortcuts of the built-in player, resolved from a plain key
// description so the mapping is testable without a DOM.

export type PlayerKeyAction =
  | { type: 'toggle_pause' }
  | { type: 'seek'; seconds: number }
  | { type: 'volume'; delta: number }
  | { type: 'toggle_mute' }
  | { type: 'toggle_fullscreen' }
  | { type: 'escape' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'screenshot' }
  | { type: 'sub_delay'; delta: number }
  | { type: 'toggle_queue' };

export interface PlayerKeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export const SEEK_STEP_SECONDS = 5;
export const SEEK_LARGE_STEP_SECONDS = 30;
export const SEEK_BUTTON_STEP_SECONDS = 10;
export const VOLUME_STEP = 5;
export const SUB_DELAY_STEP_SECONDS = 0.1;

export function resolvePlayerKeyAction(input: PlayerKeyInput): PlayerKeyAction | null {
  if (input.ctrlKey || input.altKey || input.metaKey) return null;
  const seekStep = input.shiftKey ? SEEK_LARGE_STEP_SECONDS : SEEK_STEP_SECONDS;
  switch (input.key) {
    case ' ':
    case 'Spacebar':
      return { type: 'toggle_pause' };
    case 'k':
    case 'K':
      return { type: 'sub_delay', delta: SUB_DELAY_STEP_SECONDS };
    case 'ArrowLeft':
      return { type: 'seek', seconds: -seekStep };
    case 'ArrowRight':
      return { type: 'seek', seconds: seekStep };
    case 'ArrowUp':
      return { type: 'volume', delta: VOLUME_STEP };
    case 'ArrowDown':
      return { type: 'volume', delta: -VOLUME_STEP };
    case 'm':
    case 'M':
      return { type: 'toggle_mute' };
    case 'f':
    case 'F':
      return { type: 'toggle_fullscreen' };
    case 'Escape':
      return { type: 'escape' };
    case 'n':
    case 'N':
      return { type: 'next' };
    case 'p':
    case 'P':
      return { type: 'prev' };
    case 'F12':
      return { type: 'screenshot' };
    case 'j':
    case 'J':
      return { type: 'sub_delay', delta: -SUB_DELAY_STEP_SECONDS };
    case 'q':
    case 'Q':
      return { type: 'toggle_queue' };
    default:
      return null;
  }
}

// Keys the page must not let the browser handle (page scroll, etc.).
export function isPlayerHandledKey(input: PlayerKeyInput): boolean {
  return resolvePlayerKeyAction(input) !== null;
}
