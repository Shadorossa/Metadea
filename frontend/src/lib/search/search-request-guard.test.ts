import { describe, it, expect, vi } from 'vitest';
import { SearchRequestGuard, SearchDebouncer, type DebouncerTimers } from './search-request-guard';

describe('SearchRequestGuard', () => {
  it('begin() aborts the previous search and makes its sequence stale', () => {
    const guard = new SearchRequestGuard();
    const first = guard.begin();
    expect(guard.isCurrent(first.seq)).toBe(true);
    const second = guard.begin();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(guard.isCurrent(first.seq)).toBe(false);
    expect(guard.isCurrent(second.seq)).toBe(true);
  });

  it('a stale response is detectable even when the newer search already settled', async () => {
    const guard = new SearchRequestGuard();
    const applied: string[] = [];
    const slow = guard.begin();
    const slowRequest = new Promise<string>(resolve => setTimeout(() => resolve('old'), 5));
    const fast = guard.begin();
    const fastRequest = Promise.resolve('new');
    const apply = async (seq: number, req: Promise<string>) => {
      const value = await req;
      if (!guard.isCurrent(seq)) return;
      applied.push(value);
    };
    await Promise.all([apply(slow.seq, slowRequest), apply(fast.seq, fastRequest)]);
    expect(applied).toEqual(['new']);
  });

  it('current() reuses the running search for a follow-up page', () => {
    const guard = new SearchRequestGuard();
    const first = guard.begin();
    const more = guard.current();
    expect(more.seq).toBe(first.seq);
    expect(more.signal).toBe(first.signal);
    expect(first.signal.aborted).toBe(false);
  });

  it('cancel() aborts and invalidates without starting a new search', () => {
    const guard = new SearchRequestGuard();
    const first = guard.begin();
    guard.cancel();
    expect(first.signal.aborted).toBe(true);
    expect(guard.isCurrent(first.seq)).toBe(false);
    expect(guard.current().signal.aborted).toBe(false);
  });
});

function fakeTimers() {
  let now = 0;
  const pending: Array<{ at: number; fn: () => void; id: number }> = [];
  let nextId = 1;
  const timers: DebouncerTimers = {
    set: (fn, ms) => { const id = nextId++; pending.push({ at: now + ms, fn, id }); return id; },
    clear: handle => { const i = pending.findIndex(p => p.id === handle); if (i !== -1) pending.splice(i, 1); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const p of [...pending].sort((a, b) => a.at - b.at)) {
      if (p.at <= now) { timers.clear(p.id); p.fn(); }
    }
  };
  return { timers, advance };
}

describe('SearchDebouncer', () => {
  it('fires once with the final value after the quiet period, not per keystroke', () => {
    const { timers, advance } = fakeTimers();
    const run = vi.fn();
    const debouncer = new SearchDebouncer(run, 300, 2, timers);
    for (const q of ['o', 'on', 'one', 'one ', 'one p', 'one pi', 'one pie', 'one piec', 'one piece']) {
      debouncer.submit(q);
      advance(100);
    }
    expect(run).not.toHaveBeenCalled();
    advance(300);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('one piece');
  });

  it('never schedules anything below the minimum length', () => {
    const { timers, advance } = fakeTimers();
    const run = vi.fn();
    const debouncer = new SearchDebouncer(run, 300, 2, timers);
    debouncer.submit('o');
    expect(debouncer.isPending).toBe(false);
    advance(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it('a shorter query cancels a pending longer one', () => {
    const { timers, advance } = fakeTimers();
    const run = vi.fn();
    const debouncer = new SearchDebouncer(run, 300, 2, timers);
    debouncer.submit('one');
    debouncer.submit('o');
    advance(1000);
    expect(run).not.toHaveBeenCalled();
  });

  it('flush() runs immediately and drops the pending call; cancel() drops it silently', () => {
    const { timers, advance } = fakeTimers();
    const run = vi.fn();
    const debouncer = new SearchDebouncer(run, 300, 2, timers);
    debouncer.submit('one');
    debouncer.flush('one piece');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('one piece');
    advance(1000);
    expect(run).toHaveBeenCalledTimes(1);

    debouncer.submit('zelda');
    debouncer.cancel();
    advance(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
