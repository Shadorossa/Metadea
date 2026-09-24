// Request/response bookkeeping for host → worker calls: numbered requests,
// one pending promise each, a per-call timeout, and a way to fail every
// outstanding call at once when the worker dies.

export type RpcFailure = 'timeout' | 'crashed' | 'stopped' | 'plugin';

export class PluginRpcError extends Error {
  readonly kind: RpcFailure;

  constructor(kind: RpcFailure, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'PluginRpcError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: PluginRpcError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RpcChannel {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  /**
   * Sends one request built by `send(id)` and resolves with the reply.
   * `onTimeout` runs after the call has been rejected, so the owner can
   * check whether the worker is hung.
   */
  request(send: (id: number) => void, timeoutMs: number, onTimeout?: () => void): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new PluginRpcError('timeout', `no answer within ${timeoutMs} ms`));
        onTimeout?.();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        send(id);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new PluginRpcError('crashed', err instanceof Error ? err.message : String(err)));
      }
    });
  }

  /** Settles a pending request; false for an unknown (late or forged) id. */
  settle(id: number, outcome: { ok: true; value: unknown } | { ok: false; error: string }): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    this.pending.delete(id);
    clearTimeout(entry.timer);
    if (outcome.ok) entry.resolve(outcome.value);
    else entry.reject(new PluginRpcError('plugin', outcome.error));
    return true;
  }

  rejectAll(kind: RpcFailure, message: string): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.reject(new PluginRpcError(kind, message));
    }
  }

  get size(): number {
    return this.pending.size;
  }
}
