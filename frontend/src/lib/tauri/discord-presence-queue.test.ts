import { describe, expect, it, vi } from 'vitest';
import { createPresenceQueue, PRESENCE_MIN_INTERVAL_MS } from './discord-presence';

function setup() {
  let t = 0;
  const timers: Array<{ at: number; fn: () => void }> = [];
  const send = vi.fn(async () => {});
  const q = createPresenceQueue(send, () => t, (fn, ms) => { timers.push({ at: t + ms, fn }); });
  const advance = (ms: number) => {
    t += ms;
    for (const timer of timers.splice(0).filter(x => x.at <= t)) timer.fn();
  };
  return { q, send, advance };
}

describe('presence queue', () => {
  it('sends the first update at once and never resends an identical one', () => {
    const { q, send } = setup();
    q.push({ details: 'A' });
    q.push({ details: 'A' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst into one trailing send of the latest payload', () => {
    const { q, send, advance } = setup();
    q.push({ details: 'A' });
    q.push({ details: 'B' });
    q.push({ details: 'C' });
    expect(send).toHaveBeenCalledTimes(1);
    advance(PRESENCE_MIN_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ details: 'C' });
  });

  it('drops a pending change that returns to what Discord already shows', () => {
    const { q, send, advance } = setup();
    q.push({ details: 'A' });
    q.push({ details: 'B' });
    q.push({ details: 'A' });
    advance(PRESENCE_MIN_INTERVAL_MS);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
