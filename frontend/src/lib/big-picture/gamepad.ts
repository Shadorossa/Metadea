// Gamepad input for Big Picture mode, over the browser Gamepad API's
// "standard" layout (Xbox and PlayStation pads both report it in WebView2).
// Everything that decides WHAT a frame means — edge detection, the D-pad /
// stick repeat, the Start+Select chord, controller family — is pure and
// clock-injected (see gamepad.test.ts). createGamepadLoop is the only part
// that touches navigator/requestAnimationFrame, and it only runs while the
// caller keeps it started.
import type { FocusDirection } from './focus-grid';

/** Button indices of the standard mapping. */
export const PAD_BUTTON = {
  a: 0, b: 1, x: 2, y: 3,
  lb: 4, rb: 5, lt: 6, rt: 7,
  select: 8, start: 9, ls: 10, rs: 11,
  up: 12, down: 13, left: 14, right: 15,
  guide: 16,
} as const;

export const STICK_DEAD_ZONE = 0.4;
export const REPEAT_INITIAL_DELAY_MS = 350;
export const REPEAT_INTERVAL_MS = 120;
/** How long Start+Select must be held together to count as Guide. */
export const CHORD_HOLD_MS = 500;
const TRIGGER_THRESHOLD = 0.5;

export type BigPictureAction =
  | FocusDirection
  | 'confirm' | 'back' | 'details' | 'search' | 'menu'
  | 'tab_prev' | 'tab_next' | 'page_prev' | 'page_next'
  | 'guide';

export type ControllerFamily = 'xbox' | 'playstation' | 'nintendo' | 'generic';

export interface PadFrame {
  buttons: readonly boolean[];
  axes: readonly number[];
}

export interface GamepadLike {
  index: number;
  id: string;
  connected: boolean;
  mapping?: string;
  buttons: ArrayLike<{ pressed: boolean; value: number }>;
  axes: ArrayLike<number>;
}

export function readPadFrame(pad: Pick<GamepadLike, 'buttons' | 'axes'>): PadFrame {
  const buttons: boolean[] = [];
  for (let i = 0; i < pad.buttons.length; i += 1) {
    const button = pad.buttons[i];
    // Analog triggers report `pressed` early on some drivers; the value
    // threshold keeps a resting finger from firing them.
    buttons.push(i === PAD_BUTTON.lt || i === PAD_BUTTON.rt ? button.value >= TRIGGER_THRESHOLD : button.pressed);
  }
  return { buttons, axes: Array.from(pad.axes) };
}

/** Controller family from `Gamepad.id` — decides which button glyphs to show. */
export function detectControllerFamily(id: string): ControllerFamily {
  const s = id.toLowerCase();
  // Microsoft first: "Xbox Wireless Controller" also contains the bare
  // "Wireless Controller" a DualShock 4 reports over Bluetooth.
  if (/045e|xbox|xinput|microsoft/.test(s)) return 'xbox';
  // Sony's USB vendor id is 054c; DualShock/DualSense names cover Bluetooth.
  if (/054c|dualshock|dualsense|playstation|wireless controller|ps[345]/.test(s)) return 'playstation';
  if (/057e|nintendo|switch|joy-con|pro controller/.test(s)) return 'nintendo';
  return 'generic';
}

/** The dominant stick direction past the dead zone, if any. */
export function stickDirection(x: number, y: number, deadZone = STICK_DEAD_ZONE): FocusDirection | null {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (Math.max(ax, ay) < deadZone) return null;
  if (ax >= ay) return x > 0 ? 'right' : 'left';
  return y > 0 ? 'down' : 'up';
}

export function dpadDirection(buttons: readonly boolean[]): FocusDirection | null {
  if (buttons[PAD_BUTTON.up]) return 'up';
  if (buttons[PAD_BUTTON.down]) return 'down';
  if (buttons[PAD_BUTTON.left]) return 'left';
  if (buttons[PAD_BUTTON.right]) return 'right';
  return null;
}

export interface EdgeDetector {
  /** Indices that went down / up since the previous update. */
  update(buttons: readonly boolean[]): { pressed: number[]; released: number[] };
}

export function createEdgeDetector(): EdgeDetector {
  let previous: readonly boolean[] = [];
  return {
    update(buttons) {
      const pressed: number[] = [];
      const released: number[] = [];
      const length = Math.max(buttons.length, previous.length);
      for (let i = 0; i < length; i += 1) {
        const now = !!buttons[i];
        const before = !!previous[i];
        if (now && !before) pressed.push(i);
        else if (!now && before) released.push(i);
      }
      previous = buttons.slice();
      return { pressed, released };
    },
  };
}

export interface RepeatOptions {
  initialDelayMs?: number;
  repeatMs?: number;
}

export interface DirectionRepeater {
  /** The direction to act on this frame (on press, then after the initial
   *  delay, then every repeat interval), or null. */
  update(direction: FocusDirection | null, nowMs: number): FocusDirection | null;
}

export function createDirectionRepeater(options: RepeatOptions = {}): DirectionRepeater {
  const initialDelay = options.initialDelayMs ?? REPEAT_INITIAL_DELAY_MS;
  const interval = options.repeatMs ?? REPEAT_INTERVAL_MS;
  let held: FocusDirection | null = null;
  let nextFireAt = 0;
  return {
    update(direction, nowMs) {
      if (direction !== held) {
        held = direction;
        nextFireAt = nowMs + initialDelay;
        return direction;
      }
      if (!direction || nowMs < nextFireAt) return null;
      // Keeps a steady cadence; after a long frame gap (window hidden, GC)
      // it restarts from now instead of bursting to catch up.
      nextFireAt = nowMs - nextFireAt >= interval ? nowMs + interval : nextFireAt + interval;
      return direction;
    },
  };
}

const EDGE_ACTIONS: ReadonlyArray<[number, BigPictureAction]> = [
  [PAD_BUTTON.a, 'confirm'],
  [PAD_BUTTON.b, 'back'],
  [PAD_BUTTON.x, 'details'],
  [PAD_BUTTON.y, 'search'],
  [PAD_BUTTON.lb, 'tab_prev'],
  [PAD_BUTTON.rb, 'tab_next'],
  [PAD_BUTTON.lt, 'page_prev'],
  [PAD_BUTTON.rt, 'page_next'],
  [PAD_BUTTON.guide, 'guide'],
];

export interface PadInterpreter {
  step(frame: PadFrame, nowMs: number): BigPictureAction[];
  /** Takes in a pad's first frame without acting on it: whatever is held
   *  already (the Start+Select that just opened Big Picture) only counts
   *  again after being released. */
  prime(frame: PadFrame, nowMs: number): void;
}

// One pad's frames -> actions. Start is reported on RELEASE (as 'menu') so
// holding it together with Select can mean Guide instead — many pads (and
// XInput on Windows) never expose the real Guide button.
export function createPadInterpreter(options: RepeatOptions = {}): PadInterpreter {
  const edges = createEdgeDetector();
  const repeater = createDirectionRepeater(options);
  let chordStartedAt: number | null = null;
  let chordFired = false;
  let startTainted = false;

  return {
    prime(frame, nowMs) {
      edges.update(frame.buttons);
      repeater.update(dpadDirection(frame.buttons) ?? stickDirection(frame.axes[0] ?? 0, frame.axes[1] ?? 0), nowMs);
      const startHeld = !!frame.buttons[PAD_BUTTON.start];
      const selectHeld = !!frame.buttons[PAD_BUTTON.select];
      startTainted = startHeld;
      // A chord already held counts as fired: no Guide until both let go.
      chordFired = startHeld && selectHeld;
      chordStartedAt = chordFired ? nowMs : null;
    },
    step(frame, nowMs) {
      const actions: BigPictureAction[] = [];
      const { pressed, released } = edges.update(frame.buttons);
      const direction = dpadDirection(frame.buttons) ?? stickDirection(frame.axes[0] ?? 0, frame.axes[1] ?? 0);
      const moved = repeater.update(direction, nowMs);
      if (moved) actions.push(moved);

      for (const [index, action] of EDGE_ACTIONS) {
        if (pressed.includes(index)) actions.push(action);
      }

      const startHeld = !!frame.buttons[PAD_BUTTON.start];
      const selectHeld = !!frame.buttons[PAD_BUTTON.select];
      if (startHeld && selectHeld) {
        startTainted = true;
        chordStartedAt ??= nowMs;
        if (!chordFired && nowMs - chordStartedAt >= CHORD_HOLD_MS) {
          chordFired = true;
          actions.push('guide');
        }
      } else {
        chordStartedAt = null;
        chordFired = false;
      }
      if (pressed.includes(PAD_BUTTON.start) && selectHeld) startTainted = true;
      if (released.includes(PAD_BUTTON.start)) {
        if (!startTainted) actions.push('menu');
        startTainted = false;
      }
      return actions;
    },
  };
}

export interface ConnectedPad {
  index: number;
  id: string;
  family: ControllerFamily;
}

export interface GamepadLoopOptions {
  getGamepads: () => ReadonlyArray<GamepadLike | null>;
  onActions: (actions: BigPictureAction[], pad: ConnectedPad) => void;
  /** Fired whenever the set of connected pads changes. */
  onPadsChanged?: (pads: ConnectedPad[]) => void;
  schedule: (tick: () => void) => number;
  cancel: (handle: number) => void;
  now: () => number;
  repeat?: RepeatOptions;
}

export interface GamepadLoop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

// Polls every scheduled tick (requestAnimationFrame while Big Picture is
// open, a slow timer while only listening for the Guide chord).
export function createGamepadLoop(options: GamepadLoopOptions): GamepadLoop {
  const interpreters = new Map<number, PadInterpreter>();
  let handle: number | null = null;
  let padsSignature = '';

  const tick = () => {
    handle = options.schedule(tick);
    const now = options.now();
    const connected: ConnectedPad[] = [];
    for (const pad of options.getGamepads()) {
      if (!pad || !pad.connected) continue;
      const info: ConnectedPad = { index: pad.index, id: pad.id, family: detectControllerFamily(pad.id) };
      connected.push(info);
      let interpreter = interpreters.get(pad.index);
      if (!interpreter) {
        interpreter = createPadInterpreter(options.repeat);
        interpreters.set(pad.index, interpreter);
        // Buttons already down when a pad first appears are not presses.
        interpreter.prime(readPadFrame(pad), now);
        continue;
      }
      const actions = interpreter.step(readPadFrame(pad), now);
      if (actions.length > 0) options.onActions(actions, info);
    }
    for (const index of [...interpreters.keys()]) {
      if (!connected.some(p => p.index === index)) interpreters.delete(index);
    }
    const signature = connected.map(p => `${p.index}:${p.id}`).join('|');
    if (signature !== padsSignature) {
      padsSignature = signature;
      options.onPadsChanged?.(connected);
    }
  };

  return {
    start() {
      if (handle !== null) return;
      handle = options.schedule(tick);
    },
    stop() {
      if (handle !== null) options.cancel(handle);
      handle = null;
      interpreters.clear();
    },
    get running() { return handle !== null; },
  };
}

/** navigator.getGamepads(), or nothing where the API is missing/blocked. */
export function readNavigatorGamepads(): ReadonlyArray<GamepadLike | null> {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
    return navigator.getGamepads() as ReadonlyArray<GamepadLike | null>;
  } catch {
    return [];
  }
}

export function hasConnectedGamepad(): boolean {
  return readNavigatorGamepads().some(pad => !!pad && pad.connected);
}
