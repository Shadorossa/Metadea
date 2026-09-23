import { describe, it, expect } from 'vitest';
import { runGuarded } from './useAsyncResource';

// A promise whose settlement the test controls, so ordering between
// cleanup and resolution can be pinned down exactly.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Lets every already-settled promise callback run before asserting.
const flush = () => new Promise<void>(res => setTimeout(res, 0));

describe('runGuarded', () => {
  it('resolves and hands the value to onValue', async () => {
    const d = deferred<number>();
    const values: number[] = [];
    const errors: unknown[] = [];
    runGuarded(() => d.promise, v => values.push(v), e => errors.push(e));

    d.resolve(42);
    await flush();

    expect(values).toEqual([42]);
    expect(errors).toEqual([]);
  });

  it('does not set anything once cleaned up before resolution', async () => {
    const d = deferred<string>();
    const values: string[] = [];
    const errors: unknown[] = [];
    const cleanup = runGuarded(() => d.promise, v => values.push(v), e => errors.push(e));

    cleanup();
    d.resolve('late');
    await flush();

    expect(values).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('re-running (as a deps change does) drops the stale load and keeps the fresh one', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const values: string[] = [];
    let calls = 0;
    const load = () => (++calls === 1 ? first.promise : second.promise);

    const cleanup1 = runGuarded(load, v => values.push(v), () => {});
    cleanup1();
    runGuarded(load, v => values.push(v), () => {});

    first.resolve('stale');
    second.resolve('fresh');
    await flush();

    expect(calls).toBe(2);
    expect(values).toEqual(['fresh']);
  });

  it('routes a rejection to onError and never to onValue', async () => {
    const d = deferred<number>();
    const values: number[] = [];
    const errors: unknown[] = [];
    const boom = new Error('boom');
    runGuarded(() => d.promise, v => values.push(v), e => errors.push(e));

    d.reject(boom);
    await flush();

    expect(values).toEqual([]);
    expect(errors).toEqual([boom]);
  });

  it('exposes the abort via the signal so a multi-step loader can bail early', async () => {
    let observed: AbortSignal | null = null;
    const d = deferred<null>();
    const cleanup = runGuarded(signal => { observed = signal; return d.promise; }, () => {}, () => {});

    expect(observed!.aborted).toBe(false);
    cleanup();
    expect(observed!.aborted).toBe(true);
  });
});
