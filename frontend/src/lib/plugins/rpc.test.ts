import { describe, expect, it, vi } from 'vitest';
import { PluginRpcError, RpcChannel } from './rpc';
import { parseWorkerMessage } from './protocol';
import { RateLimiter } from './host-api';

describe('RpcChannel', () => {
  it('matches replies by id and ignores unknown ids', async () => {
    const rpc = new RpcChannel();
    const sent: number[] = [];
    const a = rpc.request(id => sent.push(id), 1_000);
    const b = rpc.request(id => sent.push(id), 1_000);
    expect(rpc.settle(999, { ok: true, value: 'forged' })).toBe(false);
    rpc.settle(sent[1], { ok: true, value: 'B' });
    rpc.settle(sent[0], { ok: false, error: 'bad' });
    await expect(b).resolves.toBe('B');
    await expect(a).rejects.toMatchObject({ kind: 'plugin', message: 'bad' });
    expect(rpc.size).toBe(0);
  });

  it('times out and calls back', async () => {
    vi.useFakeTimers();
    const rpc = new RpcChannel();
    const onTimeout = vi.fn();
    const pending = rpc.request(() => {}, 500, onTimeout);
    vi.advanceTimersByTime(500);
    await expect(pending).rejects.toBeInstanceOf(PluginRpcError);
    await expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    expect(onTimeout).toHaveBeenCalledOnce();
    // A late answer is ignored.
    expect(rpc.settle(1, { ok: true, value: 1 })).toBe(false);
    vi.useRealTimers();
  });

  it('fails everything at once when the worker dies', async () => {
    const rpc = new RpcChannel();
    const calls = [rpc.request(() => {}, 1_000), rpc.request(() => {}, 1_000)];
    rpc.rejectAll('crashed', 'boom');
    for (const call of calls) await expect(call).rejects.toMatchObject({ kind: 'crashed' });
  });
});

describe('parseWorkerMessage', () => {
  it('drops malformed or unknown messages', () => {
    expect(parseWorkerMessage(null)).toBeNull();
    expect(parseWorkerMessage({ t: 'result', id: -1, ok: true })).toBeNull();
    expect(parseWorkerMessage({ t: 'host', id: 1, method: 'fs.read', args: [] })).toBeNull();
    expect(parseWorkerMessage({ t: 'invoke', cmd: 'plugin_set_enabled' })).toBeNull();
    expect(parseWorkerMessage({ t: 'host', id: 2, method: 'storage.get', args: ['k'] })).toEqual({ t: 'host', id: 2, method: 'storage.get', args: ['k'] });
    expect(parseWorkerMessage({ t: 'log', level: 'debug', args: [1, 'x'] })).toEqual({ t: 'log', level: 'info', args: ['1', 'x'] });
  });
});

describe('RateLimiter', () => {
  it('allows a burst then one per refill period', () => {
    let now = 0;
    const limiter = new RateLimiter(2, 1_000, () => now);
    expect([limiter.take(), limiter.take(), limiter.take()]).toEqual([true, true, false]);
    now = 999;
    expect(limiter.take()).toBe(false);
    now = 1_000;
    expect(limiter.take()).toBe(true);
  });
});
