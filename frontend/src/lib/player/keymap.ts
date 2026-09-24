// Keyboard shortcuts of the built-in player: one static binding table
// (id + combo + i18n description + action) that components/player/hooks/
// usePlayerKeys.ts registers in the app-wide shortcut registry under the
// `player` context, and that resolvePlayerKeyAction walks so the mapping
// stays testable without a DOM.
import { matchesShortcut, parseShortcut, type ParsedShortcut, type ShortcutKeyInput } from '../shared/keyboard/shortcut-keys';

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
  | { type: 'toggle_queue' }
  | { type: 'skip_segment' }
  | { type: 'frame_step'; direction: 'back' | 'forward' }
  | { type: 'speed_delta'; delta: number }
  | { type: 'toggle_night_mode' }
  | { type: 'cycle_track'; kind: 'sub' | 'audio' }
  | { type: 'seek_fraction'; fraction: number }
  | { type: 'seek_start' }
  | { type: 'seek_end' };

export type PlayerKeyInput = ShortcutKeyInput;

export const SEEK_STEP_SECONDS = 5;
export const SEEK_LARGE_STEP_SECONDS = 30;
export const SEEK_BUTTON_STEP_SECONDS = 10;
export const VOLUME_STEP = 5;
export const SUB_DELAY_STEP_SECONDS = 0.1;
export const SPEED_STEP = 0.25;
export const SPEED_MIN = 0.25;
/** Playback may be slowed down, never sped up past 1× (the engine caps it too). */
export const SPEED_MAX = 1;
/** `end` lands this far before the end so the file does not finish at once. */
export const SEEK_END_MARGIN_SECONDS = 5;

export interface PlayerKeyBinding {
  /** Registry id, 'player.toggle_pause'. */
  id: string;
  /** Combo(s) in the registry's spelling ('shift+arrowleft', 'ctrl+arrowright', '['). */
  keys: string | readonly string[];
  /** i18n key under `shortcuts`. */
  description: string;
  /** Fixed action, or one derived from the pressed key (digits → seek %). */
  action: PlayerKeyAction | ((key: string) => PlayerKeyAction);
  /** Fire from a range/select too (the original guard let only these through). */
  allowInInputs?: boolean;
}

const DIGIT_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export const PLAYER_KEY_BINDINGS: readonly PlayerKeyBinding[] = [
  { id: 'player.toggle_pause', keys: 'space', description: 'shortcuts.player_toggle_pause', action: { type: 'toggle_pause' }, allowInInputs: true },
  { id: 'player.seek_back', keys: 'arrowleft', description: 'shortcuts.player_seek_back', action: { type: 'seek', seconds: -SEEK_STEP_SECONDS } },
  { id: 'player.seek_forward', keys: 'arrowright', description: 'shortcuts.player_seek_forward', action: { type: 'seek', seconds: SEEK_STEP_SECONDS } },
  { id: 'player.seek_back_large', keys: 'shift+arrowleft', description: 'shortcuts.player_seek_back_large', action: { type: 'seek', seconds: -SEEK_LARGE_STEP_SECONDS } },
  { id: 'player.seek_forward_large', keys: 'shift+arrowright', description: 'shortcuts.player_seek_forward_large', action: { type: 'seek', seconds: SEEK_LARGE_STEP_SECONDS } },
  { id: 'player.volume_up', keys: 'arrowup', description: 'shortcuts.player_volume_up', action: { type: 'volume', delta: VOLUME_STEP } },
  { id: 'player.volume_down', keys: 'arrowdown', description: 'shortcuts.player_volume_down', action: { type: 'volume', delta: -VOLUME_STEP } },
  { id: 'player.toggle_mute', keys: 'm', description: 'shortcuts.player_toggle_mute', action: { type: 'toggle_mute' } },
  { id: 'player.toggle_fullscreen', keys: 'f', description: 'shortcuts.player_toggle_fullscreen', action: { type: 'toggle_fullscreen' } },
  // Escape stays a private listener in usePlayerKeys (ModalShell owns Escape
  // in the registry); it is listed here so the resolver covers every key.
  { id: 'player.escape', keys: 'escape', description: 'shortcuts.player_escape', action: { type: 'escape' }, allowInInputs: true },
  { id: 'player.next_episode', keys: ['n', 'ctrl+arrowright'], description: 'shortcuts.player_next_episode', action: { type: 'next' } },
  { id: 'player.prev_episode', keys: ['p', 'ctrl+arrowleft'], description: 'shortcuts.player_prev_episode', action: { type: 'prev' } },
  { id: 'player.screenshot', keys: 'f12', description: 'shortcuts.player_screenshot', action: { type: 'screenshot' }, allowInInputs: true },
  { id: 'player.sub_delay_down', keys: 'j', description: 'shortcuts.player_sub_delay_down', action: { type: 'sub_delay', delta: -SUB_DELAY_STEP_SECONDS } },
  { id: 'player.sub_delay_up', keys: 'k', description: 'shortcuts.player_sub_delay_up', action: { type: 'sub_delay', delta: SUB_DELAY_STEP_SECONDS } },
  { id: 'player.toggle_queue', keys: 'q', description: 'shortcuts.player_toggle_queue', action: { type: 'toggle_queue' } },
  { id: 'player.skip_segment', keys: 's', description: 'shortcuts.player_skip_segment', action: { type: 'skip_segment' } },
  { id: 'player.frame_back', keys: ',', description: 'shortcuts.player_frame_back', action: { type: 'frame_step', direction: 'back' } },
  { id: 'player.frame_forward', keys: '.', description: 'shortcuts.player_frame_forward', action: { type: 'frame_step', direction: 'forward' } },
  { id: 'player.speed_down', keys: '[', description: 'shortcuts.player_speed_down', action: { type: 'speed_delta', delta: -SPEED_STEP } },
  { id: 'player.cycle_subtitles', keys: 'c', description: 'shortcuts.player_cycle_subtitles', action: { type: 'cycle_track', kind: 'sub' } },
  { id: 'player.toggle_night_mode', keys: 'd', description: 'shortcuts.player_toggle_night_mode', action: { type: 'toggle_night_mode' } },
  { id: 'player.cycle_audio', keys: 'a', description: 'shortcuts.player_cycle_audio', action: { type: 'cycle_track', kind: 'audio' } },
  { id: 'player.seek_percent', keys: DIGIT_KEYS, description: 'shortcuts.player_seek_percent', action: key => ({ type: 'seek_fraction', fraction: Number(key) / 10 }) },
  { id: 'player.seek_start', keys: 'home', description: 'shortcuts.player_seek_start', action: { type: 'seek_start' } },
  { id: 'player.seek_end', keys: 'end', description: 'shortcuts.player_seek_end', action: { type: 'seek_end' } },
];

// Clip mode (scissors button): registered as a second `player`-context
// registration only while clip mode is on, so — being the latest in the
// same context — `[` shadows speed down just for that time and gives it
// back when clip mode ends (`]` is free: there is no speed up). Enter is free in the player table: it
// confirms the trim, then exports from the chooser. Esc cancels through the
// player's Escape ladder (dismissOverlays), not here.
export type ClipKeyAction = 'set_start' | 'set_end' | 'confirm';

export interface ClipKeyBinding {
  id: string;
  keys: string;
  description: string;
  action: ClipKeyAction;
}

export const CLIP_KEY_BINDINGS: readonly ClipKeyBinding[] = [
  { id: 'player.clip_set_start', keys: '[', description: 'shortcuts.player_clip_set_start', action: 'set_start' },
  { id: 'player.clip_set_end', keys: ']', description: 'shortcuts.player_clip_set_end', action: 'set_end' },
  { id: 'player.clip_export', keys: 'enter', description: 'shortcuts.player_clip_export', action: 'confirm' },
];

/** Ids of player bindings a clip-mode key shadows while clip mode is on. */
export function clipKeyConflicts(): string[] {
  const clipKeys = new Set(CLIP_KEY_BINDINGS.map(binding => binding.keys));
  return PLAYER_KEY_BINDINGS
    .filter(binding => (typeof binding.keys === 'string' ? [binding.keys] : binding.keys).some(key => clipKeys.has(key)))
    .map(binding => binding.id);
}

export function bindingAction(binding: PlayerKeyBinding, key: string): PlayerKeyAction {
  return typeof binding.action === 'function' ? binding.action(key) : binding.action;
}

// Modifier spellings here are explicit (ctrl+…), so the platform is moot.
const PLATFORM = { isMac: false };
const COMPILED: ReadonlyArray<{ binding: PlayerKeyBinding; parsed: ParsedShortcut[] }> = PLAYER_KEY_BINDINGS.map(binding => ({
  binding,
  parsed: (typeof binding.keys === 'string' ? [binding.keys] : binding.keys).map(spec => parseShortcut(spec, PLATFORM)),
}));

export function resolvePlayerKeyAction(input: PlayerKeyInput): PlayerKeyAction | null {
  for (const { binding, parsed } of COMPILED) {
    if (parsed.some(spec => matchesShortcut(spec, input))) return bindingAction(binding, input.key);
  }
  return null;
}

// Keys the page must not let the browser handle (page scroll, etc.).
export function isPlayerHandledKey(input: PlayerKeyInput): boolean {
  return resolvePlayerKeyAction(input) !== null;
}

export function clampSpeed(speed: number): number {
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(speed * 100) / 100));
}
