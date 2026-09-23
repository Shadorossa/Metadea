import { describe, it, expect, vi } from 'vitest';
import { AMBIENT_DUCK_FACTOR, startAmbientJukebox, type AmbientJukeboxDeps } from './ambient-jukebox';

function fakeDeps(initial: { playing: boolean; queue?: boolean }) {
  const timers: Array<{ id: number; cb: () => void }> = [];
  let nextId = 1;
  const state = { playing: initial.playing, duck: 1 };
  const deps: AmbientJukeboxDeps = {
    isPlaying: () => state.playing,
    hasQueue: () => initial.queue ?? true,
    play: vi.fn(() => { state.playing = true; }),
    stop: vi.fn(() => { state.playing = false; }),
    setDuck: vi.fn((factor: number) => { state.duck = factor; }),
    setTimeout: (cb) => {
      const id = nextId++;
      timers.push({ id, cb });
      return id;
    },
    clearTimeout: handle => {
      const index = timers.findIndex(t => t.id === handle);
      if (index !== -1) timers.splice(index, 1);
    },
  };
  const flush = () => {
    let guard = 0;
    while (timers.length > 0 && guard++ < 1000) timers.shift()?.cb();
  };
  return { deps, state, flush };
}

describe('startAmbientJukebox', () => {
  it('ducks a playing jukebox and restores it on exit', () => {
    const { deps, state, flush } = fakeDeps({ playing: true });
    const session = startAmbientJukebox(deps, { autoplay: true, fadeMs: 200 });
    expect(session.startedByAmbient).toBe(false);
    flush();
    expect(state.duck).toBeCloseTo(AMBIENT_DUCK_FACTOR);
    expect(deps.play).not.toHaveBeenCalled();
    session.end();
    flush();
    expect(state.duck).toBe(1);
    expect(deps.stop).not.toHaveBeenCalled();
    expect(state.playing).toBe(true);
  });

  it('fades through intermediate values instead of jumping', () => {
    const { deps, flush } = fakeDeps({ playing: true });
    startAmbientJukebox(deps, { autoplay: false, fadeMs: 200 });
    flush();
    const values = vi.mocked(deps.setDuck).mock.calls.map(([v]) => v);
    expect(values.length).toBeGreaterThan(2);
    expect(values[0]).toBeLessThan(1);
    expect(values[0]).toBeGreaterThan(AMBIENT_DUCK_FACTOR);
  });

  it('starts an idle jukebox softly and stops it again on exit', () => {
    const { deps, state, flush } = fakeDeps({ playing: false });
    const session = startAmbientJukebox(deps, { autoplay: true, fadeMs: 200 });
    expect(session.startedByAmbient).toBe(true);
    expect(deps.setDuck).toHaveBeenNthCalledWith(1, 0);
    expect(deps.play).toHaveBeenCalledTimes(1);
    flush();
    expect(state.duck).toBeCloseTo(AMBIENT_DUCK_FACTOR);
    session.end();
    expect(deps.stop).toHaveBeenCalledTimes(1);
    expect(state.duck).toBe(1);
  });

  it('leaves an idle jukebox alone when the option is off or the queue is empty', () => {
    const off = fakeDeps({ playing: false });
    startAmbientJukebox(off.deps, { autoplay: false }).end();
    expect(off.deps.play).not.toHaveBeenCalled();
    expect(off.deps.stop).not.toHaveBeenCalled();
    expect(off.deps.setDuck).not.toHaveBeenCalled();

    const empty = fakeDeps({ playing: false, queue: false });
    startAmbientJukebox(empty.deps, { autoplay: true }).end();
    expect(empty.deps.play).not.toHaveBeenCalled();
  });

  it('end is idempotent', () => {
    const { deps } = fakeDeps({ playing: false });
    const session = startAmbientJukebox(deps, { autoplay: true, fadeMs: 100 });
    session.end();
    session.end();
    expect(deps.stop).toHaveBeenCalledTimes(1);
  });

  it('a new session takes over an unfinished restore from where it is', () => {
    const { deps, state, flush } = fakeDeps({ playing: true });
    const first = startAmbientJukebox(deps, { autoplay: true, fadeMs: 200 });
    flush();
    first.end();
    const carried = first.abort();
    expect(carried).toBeCloseTo(AMBIENT_DUCK_FACTOR);
    const second = startAmbientJukebox(deps, { autoplay: true, fadeMs: 200, fromFactor: carried });
    flush();
    expect(state.duck).toBeCloseTo(AMBIENT_DUCK_FACTOR);
    second.end();
    flush();
    expect(state.duck).toBe(1);
  });

  it('drops a leftover duck at once when nothing plays', () => {
    const { deps, state } = fakeDeps({ playing: false });
    startAmbientJukebox(deps, { autoplay: false, fromFactor: 0.5 });
    expect(state.duck).toBe(1);
  });
});
