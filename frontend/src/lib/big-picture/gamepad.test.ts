import { describe, expect, it } from 'vitest';
import {
  CHORD_HOLD_MS, PAD_BUTTON, REPEAT_INITIAL_DELAY_MS, REPEAT_INTERVAL_MS,
  createDirectionRepeater, createEdgeDetector, createGamepadLoop, createPadInterpreter,
  detectControllerFamily, readPadFrame, stickDirection,
  type BigPictureAction, type GamepadLike, type PadFrame,
} from './gamepad';
import { glyphFor } from './glyphs';

function frame(pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): PadFrame {
  const buttons = Array.from({ length: 17 }, (_, i) => pressed.includes(i));
  return { buttons, axes };
}

describe('createEdgeDetector', () => {
  it('reports presses and releases once', () => {
    const edges = createEdgeDetector();
    expect(edges.update([false, false])).toEqual({ pressed: [], released: [] });
    expect(edges.update([true, false])).toEqual({ pressed: [0], released: [] });
    expect(edges.update([true, false])).toEqual({ pressed: [], released: [] });
    expect(edges.update([false, true])).toEqual({ pressed: [1], released: [0] });
    expect(edges.update([])).toEqual({ pressed: [], released: [1] });
  });
});

describe('stickDirection', () => {
  it('ignores the dead zone and picks the dominant axis', () => {
    expect(stickDirection(0.39, 0)).toBeNull();
    expect(stickDirection(0.2, -0.3)).toBeNull();
    expect(stickDirection(0.41, 0)).toBe('right');
    expect(stickDirection(-0.9, 0.5)).toBe('left');
    expect(stickDirection(0.3, 0.8)).toBe('down');
    expect(stickDirection(0.1, -0.5)).toBe('up');
    expect(stickDirection(0.5, 0, 0.6)).toBeNull();
  });
});

describe('createDirectionRepeater', () => {
  it('fires on press, after the initial delay, then every interval', () => {
    const repeater = createDirectionRepeater();
    const fired: number[] = [];
    for (let t = 0; t <= 800; t += 10) {
      if (repeater.update('down', t)) fired.push(t);
    }
    expect(fired[0]).toBe(0);
    expect(fired[1]).toBe(REPEAT_INITIAL_DELAY_MS);
    expect(fired[2]).toBe(REPEAT_INITIAL_DELAY_MS + REPEAT_INTERVAL_MS);
    expect(fired[3]).toBe(REPEAT_INITIAL_DELAY_MS + 2 * REPEAT_INTERVAL_MS);
    expect(fired).toHaveLength(1 + 1 + Math.floor((800 - REPEAT_INITIAL_DELAY_MS) / REPEAT_INTERVAL_MS));
  });

  it('restarts on release or a change of direction', () => {
    const repeater = createDirectionRepeater({ initialDelayMs: 100, repeatMs: 50 });
    expect(repeater.update('left', 0)).toBe('left');
    expect(repeater.update('left', 60)).toBeNull();
    expect(repeater.update('up', 70)).toBe('up');
    expect(repeater.update('up', 160)).toBeNull();
    expect(repeater.update('up', 170)).toBe('up');
    expect(repeater.update(null, 180)).toBeNull();
    expect(repeater.update('up', 190)).toBe('up');
  });

  it('does not burst after a long frame gap', () => {
    const repeater = createDirectionRepeater({ initialDelayMs: 100, repeatMs: 50 });
    repeater.update('right', 0);
    expect(repeater.update('right', 5000)).toBe('right');
    expect(repeater.update('right', 5016)).toBeNull();
    expect(repeater.update('right', 5050)).toBe('right');
  });
});

describe('createPadInterpreter', () => {
  const run = (frames: Array<[number, PadFrame]>): BigPictureAction[][] => {
    const pad = createPadInterpreter();
    return frames.map(([t, f]) => pad.step(f, t));
  };

  it('maps face buttons and shoulders on the press edge only', () => {
    const out = run([
      [0, frame()],
      [16, frame([PAD_BUTTON.a])],
      [32, frame([PAD_BUTTON.a])],
      [48, frame([PAD_BUTTON.b, PAD_BUTTON.rb])],
      [64, frame([PAD_BUTTON.x, PAD_BUTTON.y, PAD_BUTTON.lb])],
      [80, frame([PAD_BUTTON.guide])],
    ]);
    expect(out[1]).toEqual(['confirm']);
    expect(out[2]).toEqual([]);
    expect(out[3]).toEqual(['back', 'tab_next']);
    expect(out[4]).toEqual(['details', 'search', 'tab_prev']);
    expect(out[5]).toEqual(['guide']);
  });

  it('moves with the D-pad and the left stick, D-pad first', () => {
    const out = run([
      [0, frame([PAD_BUTTON.left])],
      [16, frame()],
      [32, frame([], [0, 0.95, 0, 0])],
      [48, frame([PAD_BUTTON.up], [0, 0.95, 0, 0])],
    ]);
    expect(out[0]).toEqual(['left']);
    expect(out[2]).toEqual(['down']);
    expect(out[3]).toEqual(['up']);
  });

  it('reports Start as menu on release', () => {
    const out = run([[0, frame([PAD_BUTTON.start])], [16, frame([PAD_BUTTON.start])], [32, frame()]]);
    expect(out.flat()).toEqual(['menu']);
  });

  it('turns a held Start+Select into guide, without a menu', () => {
    const both = frame([PAD_BUTTON.start, PAD_BUTTON.select]);
    const out = run([
      [0, frame([PAD_BUTTON.select])],
      [10, both],
      [10 + CHORD_HOLD_MS - 1, both],
      [10 + CHORD_HOLD_MS, both],
      [10 + CHORD_HOLD_MS + 100, both],
      [10 + CHORD_HOLD_MS + 200, frame()],
    ]);
    expect(out.flat()).toEqual(['guide']);
    expect(out[3]).toEqual(['guide']);
  });

  it('ignores what was already held when primed (no Guide flapping after opening)', () => {
    const pad = createPadInterpreter();
    const both = frame([PAD_BUTTON.start, PAD_BUTTON.select, PAD_BUTTON.a]);
    pad.prime(both, 0);
    expect(pad.step(both, 16)).toEqual([]);
    expect(pad.step(both, 16 + CHORD_HOLD_MS * 3)).toEqual([]);
    // Releasing Start after priming is not a menu press either.
    expect(pad.step(frame(), 2000)).toEqual([]);
    // A fresh chord works again.
    pad.step(frame([PAD_BUTTON.select, PAD_BUTTON.start]), 3000);
    expect(pad.step(frame([PAD_BUTTON.select, PAD_BUTTON.start]), 3000 + CHORD_HOLD_MS)).toEqual(['guide']);
  });

  it('uses the trigger value threshold', () => {
    const pad = { buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === PAD_BUTTON.lt, value: i === PAD_BUTTON.lt ? 0.2 : 0 })), axes: [0, 0] };
    expect(readPadFrame(pad).buttons[PAD_BUTTON.lt]).toBe(false);
    pad.buttons[PAD_BUTTON.rt] = { pressed: false, value: 0.8 };
    expect(readPadFrame(pad).buttons[PAD_BUTTON.rt]).toBe(true);
  });
});

describe('detectControllerFamily and glyphs', () => {
  it('recognises the common pads', () => {
    expect(detectControllerFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(detectControllerFamily('045e-0b13-Xbox Wireless Controller')).toBe('xbox');
    expect(detectControllerFamily('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(detectControllerFamily('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(detectControllerFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('nintendo');
    expect(detectControllerFamily('8BitDo SN30 Pro')).toBe('generic');
  });

  it('shows the family’s own symbols', () => {
    expect(glyphFor('xbox', 'confirm').label).toBe('A');
    expect(glyphFor('playstation', 'confirm').label).toBe('✕');
    expect(glyphFor('playstation', 'back').label).toBe('○');
    expect(glyphFor('playstation', 'search').label).toBe('△');
    expect(glyphFor('nintendo', 'confirm').label).toBe('B');
    expect(glyphFor('keyboard', 'back').label).toBe('Esc');
  });
});

describe('createGamepadLoop', () => {
  function fakePad(index: number, pressed: number[]): GamepadLike {
    return {
      index, id: 'Xbox Wireless Controller', connected: true,
      buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
      axes: [0, 0, 0, 0],
    };
  }

  it('polls on each scheduled tick, ignores buttons held when a pad appears and stops cleanly', () => {
    let queued: (() => void) | null = null;
    let now = 0;
    let pads: (GamepadLike | null)[] = [fakePad(0, [PAD_BUTTON.a])];
    const seen: BigPictureAction[] = [];
    const padEvents: number[] = [];
    const loop = createGamepadLoop({
      getGamepads: () => pads,
      onActions: actions => seen.push(...actions),
      onPadsChanged: list => padEvents.push(list.length),
      schedule: tick => { queued = tick; return 1; },
      cancel: () => { queued = null; },
      now: () => now,
    });
    const tick = () => { const fn = queued; queued = null; now += 16; fn?.(); };

    loop.start();
    expect(loop.running).toBe(true);
    tick(); // A already down when the pad shows up: not a press
    expect(seen).toEqual([]);
    expect(padEvents).toEqual([1]);
    pads = [fakePad(0, [])];
    tick();
    pads = [fakePad(0, [PAD_BUTTON.b])];
    tick();
    expect(seen).toEqual(['back']);
    pads = [];
    tick();
    expect(padEvents).toEqual([1, 0]);
    loop.stop();
    expect(loop.running).toBe(false);
    expect(queued).toBeNull();
  });
});
