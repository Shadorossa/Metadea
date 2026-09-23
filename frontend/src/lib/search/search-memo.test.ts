import { describe, it, expect, vi } from 'vitest';
import { SearchMemo } from './search-memo';

function clock(start = 0) {
  let t = start;
  return { now: () => t, tick: (ms: number) => { t += ms; } };
}

describe('SearchMemo values', () => {
  it('returns a set value until its TTL elapses', () => {
    const c = clock();
    const memo = new SearchMemo<number>({ ttlMs: 1000, maxEntries: 10, now: c.now });
    memo.set('a', 1);
    c.tick(999);
    expect(memo.get('a')).toBe(1);
    c.tick(1);
    expect(memo.get('a')).toBeUndefined();
    expect(memo.size).toBe(0);
  });

  it('evicts the least recently used entry past maxEntries', () => {
    const memo = new SearchMemo<number>({ ttlMs: 1000, maxEntries: 2 });
    memo.set('a', 1);
    memo.set('b', 2);
    memo.get('a');       // 'a' is now the most recently used
    memo.set('c', 3);    // evicts 'b'
    expect(memo.get('b')).toBeUndefined();
    expect(memo.get('a')).toBe(1);
    expect(memo.get('c')).toBe(3);
  });

  it('only hits on the exact key — a prefix is a different query', () => {
    const memo = new SearchMemo<string>({ ttlMs: 1000, maxEntries: 10 });
    memo.set('anime:1:one pie', 'x');
    expect(memo.get('anime:1:one piece')).toBeUndefined();
  });
});

describe('SearchMemo.fetch', () => {
  it('runs once for concurrent callers with the same key and memoises the result', async () => {
    const memo = new SearchMemo<string>({ ttlMs: 1000, maxEntries: 10 });
    let resolve!: (v: string) => void;
    const run = vi.fn(() => new Promise<string>(r => { resolve = r; }));
    const p1 = memo.fetch('k', run);
    const p2 = memo.fetch('k', run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(memo.isInFlight('k')).toBe(true);
    resolve('v');
    expect(await p1).toBe('v');
    expect(await p2).toBe('v');
    expect(memo.isInFlight('k')).toBe(false);
    expect(await memo.fetch('k', run)).toBe('v');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never memoises a rejection', async () => {
    const memo = new SearchMemo<string>({ ttlMs: 1000, maxEntries: 10 });
    const run = vi.fn<(s: AbortSignal) => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');
    await expect(memo.fetch('k', run)).rejects.toThrow('boom');
    expect(await memo.fetch('k', run)).toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('rejects an aborting caller immediately but keeps the shared request alive for the others', async () => {
    const memo = new SearchMemo<string>({ ttlMs: 1000, maxEntries: 10 });
    let resolve!: (v: string) => void;
    let underlying!: AbortSignal;
    const run = (signal: AbortSignal) => { underlying = signal; return new Promise<string>(r => { resolve = r; }); };
    const a = new AbortController();
    const b = new AbortController();
    const pa = memo.fetch('k', run, a.signal);
    const pb = memo.fetch('k', run, b.signal);
    a.abort();
    await expect(pa).rejects.toMatchObject({ name: 'AbortError' });
    expect(underlying.aborted).toBe(false);
    resolve('v');
    expect(await pb).toBe('v');
    expect(memo.get('k')).toBe('v');
  });

  it('aborts the underlying request once every caller has aborted, and memoises nothing', async () => {
    const memo = new SearchMemo<string>({ ttlMs: 1000, maxEntries: 10 });
    let underlying!: AbortSignal;
    const run = (signal: AbortSignal) => { underlying = signal; return new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))); };
    const a = new AbortController();
    const pa = memo.fetch('k', run, a.signal);
    a.abort();
    await expect(pa).rejects.toMatchObject({ name: 'AbortError' });
    expect(underlying.aborted).toBe(true);
    expect(memo.isInFlight('k')).toBe(false);
    expect(memo.get('k')).toBeUndefined();
  });

  it('rejects without running for an already-aborted signal', async () => {
    const memo = new SearchMemo<string>({ ttlMs: 1000, maxEntries: 10 });
    const run = vi.fn(async () => 'v');
    const c = new AbortController();
    c.abort();
    await expect(memo.fetch('k', run, c.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(run).not.toHaveBeenCalled();
  });
});
