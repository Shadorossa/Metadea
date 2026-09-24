import { describe, expect, it } from 'vitest';
import { createTaskGate } from './sakuga-gate';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

describe('createTaskGate', () => {
  it('runs at most `max` tasks at once, the rest in arrival order', async () => {
    const gate = createTaskGate(2);
    const started: number[] = [];
    const blockers = [deferred(), deferred(), deferred(), deferred()];
    const runs = blockers.map((blocker, i) => gate.run(async () => { started.push(i); await blocker.promise; return i; }));
    await Promise.resolve();
    expect(started).toEqual([0, 1]);
    expect(gate.waiting).toBe(2);
    blockers[1].resolve();
    await runs[1];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    blockers[0].resolve();
    blockers[2].resolve();
    blockers[3].resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
    expect(gate.active).toBe(0);
  });

  it('frees the slot when a task fails', async () => {
    const gate = createTaskGate(1);
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await gate.run(async () => 'next')).toBe('next');
  });
});
