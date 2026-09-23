// The Jukebox side of Ambient mode, with the engine injected so the fade
// rules are testable: a jukebox that is already playing is ducked to
// AMBIENT_DUCK_FACTOR and restored on exit; an idle one is started softly
// (when the setting allows it) and stopped again on exit — only if this
// session was the one that started it.
export const AMBIENT_DUCK_FACTOR = 0.35;
const FADE_MS = 1500;
const FADE_STEP_MS = 50;

export interface AmbientJukeboxDeps {
  isPlaying: () => boolean;
  hasQueue: () => boolean;
  play: () => void;
  stop: () => void;
  /** Volume multiplier on top of the user's volume (1 = untouched). */
  setDuck: (factor: number) => void;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface AmbientJukeboxSession {
  /** Whether this session started the jukebox itself. */
  readonly startedByAmbient: boolean;
  /** Restore (or stop) and release; idempotent. */
  end: () => void;
  /** Stops any fade where it is and returns the duck factor left applied —
   *  a new session that takes over starts from there. */
  abort: () => number;
}

export interface AmbientJukeboxOptions {
  /** Start the queue when nothing is playing. */
  autoplay: boolean;
  fadeMs?: number;
  /** Duck factor currently applied (a previous session's unfinished fade). */
  fromFactor?: number;
}

export function startAmbientJukebox(deps: AmbientJukeboxDeps, options: AmbientJukeboxOptions): AmbientJukeboxSession {
  const fadeMs = options.fadeMs ?? FADE_MS;
  let factor = options.fromFactor ?? 1;
  let timer: unknown = null;
  let ended = false;

  const cancelFade = () => {
    if (timer === null) return;
    deps.clearTimeout(timer);
    timer = null;
  };

  const apply = (value: number) => {
    factor = value;
    deps.setDuck(value);
  };

  // Linear ramp from the current factor to `target`.
  const fadeTo = (target: number, done?: () => void) => {
    cancelFade();
    const steps = Math.max(1, Math.round(fadeMs / FADE_STEP_MS));
    const from = factor;
    let step = 0;
    const tick = () => {
      step += 1;
      apply(step >= steps ? target : from + ((target - from) * step) / steps);
      if (step >= steps) {
        timer = null;
        done?.();
        return;
      }
      timer = deps.setTimeout(tick, FADE_STEP_MS);
    };
    timer = deps.setTimeout(tick, FADE_STEP_MS);
  };

  let startedByAmbient = false;
  if (deps.isPlaying()) {
    fadeTo(AMBIENT_DUCK_FACTOR);
  } else if (options.autoplay && deps.hasQueue()) {
    startedByAmbient = true;
    apply(0);
    deps.play();
    fadeTo(AMBIENT_DUCK_FACTOR);
  } else if (factor !== 1) {
    // Silent anyway: drop a previous session's leftover duck at once.
    apply(1);
  }

  return {
    startedByAmbient,
    end() {
      if (ended) return;
      ended = true;
      cancelFade();
      if (startedByAmbient) {
        deps.stop();
        apply(1);
        return;
      }
      if (factor !== 1) fadeTo(1);
    },
    abort() {
      ended = true;
      cancelFade();
      return factor;
    },
  };
}
