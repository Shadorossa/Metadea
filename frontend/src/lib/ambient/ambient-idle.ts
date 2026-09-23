// Ambient TV mode's idle timer: pure, React-free, with an injectable clock.
//
// Cheap by construction: user input only stamps `lastActivity` (no timer
// churn on every pointermove); a single timeout sleeps until the earliest
// moment the delay could have elapsed and, when it wakes early because of
// newer activity, goes back to sleep for the remainder. Nothing is scheduled
// at all while the gate is closed (not fullscreen / Big Picture, window
// hidden or unfocused, setting off) or while the screensaver is showing.
import type { AmbientBlocker } from './ambient-blockers';

export interface AmbientGate {
  /** Settings › Ambient mode. */
  enabled: boolean;
  /** The main window is fullscreen. */
  fullscreen: boolean;
  /** Big Picture mode is open. */
  bigPicture: boolean;
  /** document.visibilityState === 'visible'. */
  visible: boolean;
  /** The window has focus — a launched game on top of a fullscreen
   *  Metadea must not count as "idle in Metadea". */
  focused: boolean;
}

/** Ambient mode can only arm while enabled, in fullscreen or Big Picture,
 *  and with the window visible and focused. */
export function isAmbientGateOpen(gate: AmbientGate): boolean {
  return gate.enabled && (gate.fullscreen || gate.bigPicture) && gate.visible && gate.focused;
}

export interface IdleClock {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface AmbientIdleOptions {
  clock: IdleClock;
  readGate: () => AmbientGate;
  readDelayMs: () => number;
  /** Read only when the delay has elapsed — anything here postpones the
   *  screensaver by a whole new delay. */
  readBlockers: () => readonly AmbientBlocker[];
  onIdle: () => void;
}

export interface AmbientIdleController {
  /** User input: pointer, key, wheel, touch or gamepad. */
  activity: () => void;
  /** Re-read the gate and the delay (fullscreen/focus/visibility/settings changed). */
  refresh: () => void;
  /** The screensaver is up: stop counting. */
  suspend: () => void;
  /** The screensaver closed: start counting again from now. */
  resume: () => void;
  dispose: () => void;
  /** Whether a timeout is pending (for tests and diagnostics). */
  isArmed: () => boolean;
}

export function createAmbientIdleController(options: AmbientIdleOptions): AmbientIdleController {
  const { clock } = options;
  let lastActivity = clock.now();
  let handle: unknown = null;
  let suspended = false;
  let disposed = false;

  const disarm = () => {
    if (handle === null) return;
    clock.clearTimeout(handle);
    handle = null;
  };

  const schedule = (ms: number) => {
    disarm();
    handle = clock.setTimeout(fire, Math.max(0, ms));
  };

  function fire(): void {
    handle = null;
    if (suspended || disposed || !isAmbientGateOpen(options.readGate())) return;
    const delay = options.readDelayMs();
    const idleFor = clock.now() - lastActivity;
    if (idleFor < delay) {
      schedule(delay - idleFor);
      return;
    }
    if (options.readBlockers().length > 0) {
      // Watching, reading or playing is not idling: wait a whole new delay
      // once the blocker is gone rather than jumping in the moment it ends.
      lastActivity = clock.now();
      schedule(delay);
      return;
    }
    suspended = true;
    options.onIdle();
  }

  const refresh = () => {
    if (disposed || suspended) return;
    if (!isAmbientGateOpen(options.readGate())) {
      disarm();
      return;
    }
    // Opening the gate (entering fullscreen, focusing the window) starts
    // the count from now; a refresh while armed (delay changed) keeps it.
    if (handle === null) lastActivity = clock.now();
    schedule(options.readDelayMs() - (clock.now() - lastActivity));
  };

  return {
    activity() {
      lastActivity = clock.now();
    },
    refresh,
    suspend() {
      suspended = true;
      disarm();
    },
    resume() {
      if (disposed) return;
      suspended = false;
      lastActivity = clock.now();
      disarm();
      refresh();
    },
    dispose() {
      disposed = true;
      disarm();
    },
    isArmed: () => handle !== null,
  };
}
