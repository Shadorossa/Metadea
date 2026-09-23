import { describe, it, expect, vi } from 'vitest';
import { createAmbientIdleController, isAmbientGateOpen, type AmbientGate, type IdleClock } from './ambient-idle';
import type { AmbientBlocker } from './ambient-blockers';

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  const clock: IdleClock = {
    now: () => now,
    setTimeout: (cb, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, cb });
      return id;
    },
    clearTimeout: handle => { timers.delete(handle as number); },
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].cb();
    }
    now = target;
  };
  return { clock, advance, pending: () => timers.size };
}

const OPEN: AmbientGate = { enabled: true, fullscreen: true, bigPicture: false, visible: true, focused: true };
const MINUTE = 60_000;

function setup(overrides: { gate?: Partial<AmbientGate>; delay?: number } = {}) {
  const { clock, advance, pending } = fakeClock();
  const state = { gate: { ...OPEN, ...overrides.gate }, delay: overrides.delay ?? 2 * MINUTE, blockers: [] as AmbientBlocker[] };
  const onIdle = vi.fn();
  const controller = createAmbientIdleController({
    clock,
    readGate: () => state.gate,
    readDelayMs: () => state.delay,
    readBlockers: () => state.blockers,
    onIdle,
  });
  controller.refresh();
  return { controller, state, onIdle, advance, pending };
}

describe('isAmbientGateOpen', () => {
  it('needs fullscreen or Big Picture, plus enabled, visible and focused', () => {
    expect(isAmbientGateOpen(OPEN)).toBe(true);
    expect(isAmbientGateOpen({ ...OPEN, fullscreen: false })).toBe(false);
    expect(isAmbientGateOpen({ ...OPEN, fullscreen: false, bigPicture: true })).toBe(true);
    expect(isAmbientGateOpen({ ...OPEN, enabled: false })).toBe(false);
    expect(isAmbientGateOpen({ ...OPEN, visible: false })).toBe(false);
    expect(isAmbientGateOpen({ ...OPEN, focused: false })).toBe(false);
  });
});

describe('createAmbientIdleController', () => {
  it('fires once the delay passes without input', () => {
    const { onIdle, advance } = setup();
    advance(2 * MINUTE - 1);
    expect(onIdle).not.toHaveBeenCalled();
    advance(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('honours the configured delay', () => {
    const { onIdle, advance } = setup({ delay: 5 * MINUTE });
    advance(4 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    advance(MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('activity pushes the deadline back without re-arming a timer per event', () => {
    const { controller, onIdle, advance, pending } = setup();
    advance(90_000);
    controller.activity();
    controller.activity();
    expect(pending()).toBe(1);
    advance(60_000);
    expect(onIdle).not.toHaveBeenCalled();
    advance(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('never arms outside fullscreen / Big Picture, and arms once the gate opens', () => {
    const { controller, state, onIdle, advance, pending } = setup({ gate: { fullscreen: false } });
    expect(pending()).toBe(0);
    advance(10 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    state.gate = { ...state.gate, bigPicture: true };
    controller.refresh();
    advance(2 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('disarms when the window loses focus or is hidden', () => {
    const { controller, state, onIdle, advance, pending } = setup();
    advance(MINUTE);
    state.gate = { ...state.gate, focused: false };
    controller.refresh();
    expect(pending()).toBe(0);
    advance(5 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    // Refocused: the count starts over.
    state.gate = { ...state.gate, focused: true };
    controller.refresh();
    advance(2 * MINUTE - 1);
    expect(onIdle).not.toHaveBeenCalled();
    advance(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the gate closed without a refresh', () => {
    const { state, onIdle, advance } = setup();
    state.gate = { ...state.gate, visible: false };
    advance(3 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('a blocker postpones by a whole new delay', () => {
    const { state, onIdle, advance } = setup();
    state.blockers = ['player'];
    advance(2 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    state.blockers = [];
    advance(MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    advance(MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while suspended and counts from the resume', () => {
    const { controller, onIdle, advance } = setup();
    advance(2 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
    advance(10 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
    controller.resume();
    advance(2 * MINUTE - 1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    advance(1);
    expect(onIdle).toHaveBeenCalledTimes(2);
  });

  it('a shorter delay applies to the time already idle', () => {
    const { controller, state, onIdle, advance } = setup({ delay: 10 * MINUTE });
    advance(3 * MINUTE);
    state.delay = 2 * MINUTE;
    controller.refresh();
    advance(0);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('dispose cancels everything', () => {
    const { controller, onIdle, advance, pending } = setup();
    controller.dispose();
    expect(pending()).toBe(0);
    controller.refresh();
    advance(5 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
  });
});
