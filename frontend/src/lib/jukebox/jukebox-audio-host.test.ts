import { describe, it, expect } from 'vitest';
import { claimJukeboxAudio, claimJukeboxBoot, type AudioListeners } from './jukebox-audio-host';

// Stands in for one evaluated copy of jukebox-engine.ts: counts the
// `ended` events its own handler receives.
function engineCopy() {
  const received = { ended: 0 };
  const listeners = (): AudioListeners => [['ended', () => { received.ended += 1; }]];
  return { received, listeners };
}

describe('claimJukeboxAudio', () => {
  it('creates the element once and attaches the listeners', () => {
    const host = {};
    let created = 0;
    const copy = engineCopy();
    const { element, adopted } = claimJukeboxAudio(host, () => { created += 1; return new EventTarget(); }, copy.listeners);
    expect(adopted).toBe(false);
    expect(created).toBe(1);
    element.dispatchEvent(new Event('ended'));
    expect(copy.received.ended).toBe(1);
  });

  it('lets a later module copy take over the same element instead of replacing it', () => {
    const host = {};
    const first = engineCopy();
    const second = engineCopy();
    const original = claimJukeboxAudio(host, () => new EventTarget(), first.listeners).element;
    const takeover = claimJukeboxAudio(host, () => { throw new Error('must reuse the playing element'); }, second.listeners);
    expect(takeover.adopted).toBe(true);
    expect(takeover.element).toBe(original);
    // `ended` now reaches only the copy that owns the element: one advance,
    // not one per copy and not none.
    original.dispatchEvent(new Event('ended'));
    expect(first.received.ended).toBe(0);
    expect(second.received.ended).toBe(1);
  });

  it('keeps one owner across repeated takeovers', () => {
    const host = {};
    const copies = [engineCopy(), engineCopy(), engineCopy()];
    let element: EventTarget | null = null;
    for (const copy of copies) element = claimJukeboxAudio(host, () => new EventTarget(), copy.listeners).element;
    element!.dispatchEvent(new Event('ended'));
    expect(copies.map(c => c.received.ended)).toEqual([0, 0, 1]);
  });
});

describe('claimJukeboxBoot', () => {
  it('is true once per host', () => {
    const host = {};
    expect(claimJukeboxBoot(host)).toBe(true);
    expect(claimJukeboxBoot(host)).toBe(false);
    expect(claimJukeboxBoot({})).toBe(true);
  });
});
