// One plugin's dedicated worker, seen from the page: started lazily on the
// first call or event, answered over the RPC channel, and isolated when it
// misbehaves. A worker that throws at load, reports an error, or stops
// answering pings is terminated; its pending calls fail; the next demand
// restarts it after an exponential backoff, and after MAX_CRASHES in a row
// it stays down (status `failed`) until the plugin is reloaded.
import type { PluginManifest, PluginEventName } from './manifest';
import { parseWorkerMessage, type ExtensionPointName, type HostToWorker } from './protocol';
import { PluginRpcError, RpcChannel } from './rpc';
import { handleHostCall, HostCallError, NOTIFY_BURST, NOTIFY_REFILL_MS, RateLimiter, type PluginHostBackend } from './host-api';
import { composeWorkerSource, type WorkerFactory, type WorkerLike } from './worker-source';

export type PluginWorkerState = 'idle' | 'starting' | 'running' | 'crashed' | 'failed';

export interface PluginWorkerStatus {
  state: PluginWorkerState;
  /** Last crash or load error (technical; shown under the error badge). */
  error: string | null;
  crashes: number;
}

export interface PluginEntryData {
  source: string;
  manifest: PluginManifest;
  settings: Record<string, unknown>;
}

export interface PluginWorkerHostOptions {
  pluginId: string;
  /** Rust refuses a disabled plugin here, so a disabled one never starts. */
  loadEntry: (pluginId: string) => Promise<PluginEntryData>;
  backend: PluginHostBackend;
  createWorker: WorkerFactory;
  onStatus?: (status: PluginWorkerStatus) => void;
  onLog?: (level: 'info' | 'warn' | 'error', args: string[]) => void;
  now?: () => number;
  /** How long a hung worker gets to answer a ping after a call times out. */
  pingTimeoutMs?: number;
}

export const DEFAULT_CALL_TIMEOUT_MS = 30_000;
export const MAX_CRASHES = 5;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 60_000;

export function crashBackoffMs(crashes: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, crashes - 1));
}

export class PluginUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginUnavailableError';
  }
}

export class PluginWorkerHost {
  private worker: WorkerLike | null = null;
  private starting: Promise<WorkerLike> | null = null;
  private readonly rpc = new RpcChannel();
  private manifest: PluginManifest | null = null;
  private notifyLimiter: RateLimiter;
  private status: PluginWorkerStatus = { state: 'idle', error: null, crashes: 0 };
  private retryAt = 0;
  /** Bumped on every start/stop so callbacks from an old worker are ignored. */
  private generation = 0;
  private readonly now: () => number;

  constructor(private readonly options: PluginWorkerHostOptions) {
    this.now = options.now ?? Date.now;
    this.notifyLimiter = new RateLimiter(NOTIFY_BURST, NOTIFY_REFILL_MS, this.now);
  }

  get pluginId(): string {
    return this.options.pluginId;
  }

  getStatus(): PluginWorkerStatus {
    return this.status;
  }

  private setStatus(next: Partial<PluginWorkerStatus>): void {
    this.status = { ...this.status, ...next };
    this.options.onStatus?.(this.status);
  }

  /** Calls a registered contribution handler (starting the worker if needed). */
  async call(point: ExtensionPointName, target: string, method: string | undefined, args: unknown[], timeoutMs = DEFAULT_CALL_TIMEOUT_MS): Promise<unknown> {
    const worker = await this.ensureStarted();
    const generation = this.generation;
    const value = await this.rpc.request(
      id => worker.postMessage({ t: 'call', id, point, target, method, args } satisfies HostToWorker),
      timeoutMs,
      () => this.checkAlive(generation),
    );
    // A successful answer ends a crash streak.
    if (this.status.crashes > 0 && this.generation === generation) this.setStatus({ crashes: 0, error: null });
    return value;
  }

  /** Delivers a read-only event; starts the worker when needed. Never throws. */
  async dispatchEvent(name: PluginEventName, payload: unknown): Promise<void> {
    try {
      const worker = await this.ensureStarted();
      worker.postMessage({ t: 'event', name, payload } satisfies HostToWorker);
    } catch {
      // Unavailable (disabled, crashed, backing off): events are best-effort.
    }
  }

  /** Terminates the worker (disable, uninstall, settings change). The next demand starts a fresh one. */
  stop(): void {
    this.generation += 1;
    this.worker?.terminate();
    this.worker = null;
    this.starting = null;
    this.rpc.rejectAll('stopped', 'the plugin was stopped');
    this.retryAt = 0;
    this.setStatus({ state: 'idle', error: null, crashes: 0 });
  }

  private ensureStarted(): Promise<WorkerLike> {
    if (this.worker) return Promise.resolve(this.worker);
    if (this.starting) return this.starting;
    if (this.status.state === 'failed') {
      return Promise.reject(new PluginUnavailableError(this.status.error ?? 'the plugin failed too many times'));
    }
    if (this.status.state === 'crashed' && this.now() < this.retryAt) {
      return Promise.reject(new PluginUnavailableError(`restarting in ${Math.ceil((this.retryAt - this.now()) / 1000)} s`));
    }
    const generation = ++this.generation;
    this.setStatus({ state: 'starting' });
    this.starting = this.options.loadEntry(this.options.pluginId).then(
      entry => {
        if (generation !== this.generation) throw new PluginUnavailableError('the plugin was stopped');
        this.manifest = entry.manifest;
        const source = composeWorkerSource(entry.source, { id: entry.manifest.id, version: entry.manifest.version, settings: entry.settings });
        let worker: WorkerLike;
        try {
          worker = this.options.createWorker(source, `metadea-plugin:${entry.manifest.id}`);
        } catch (err) {
          this.crash(generation, err instanceof Error ? err.message : String(err));
          throw new PluginUnavailableError(this.status.error ?? 'could not start the plugin');
        }
        worker.onmessage = event => this.onMessage(generation, worker, event.data);
        worker.onerror = event => {
          event.preventDefault?.();
          this.crash(generation, event.message || 'the plugin worker reported an error');
        };
        this.worker = worker;
        this.starting = null;
        this.setStatus({ state: 'running' });
        return worker;
      },
      err => {
        this.starting = null;
        if (generation === this.generation) {
          // Not a crash: the plugin is disabled, missing or not consented.
          this.setStatus({ state: 'idle', error: err instanceof Error ? err.message : String(err) });
        }
        throw err;
      },
    );
    return this.starting;
  }

  private crash(generation: number, reason: string): void {
    if (generation !== this.generation) return;
    this.generation += 1;
    this.worker?.terminate();
    this.worker = null;
    this.starting = null;
    this.rpc.rejectAll('crashed', reason);
    const crashes = this.status.crashes + 1;
    this.retryAt = this.now() + crashBackoffMs(crashes);
    this.setStatus({ state: crashes >= MAX_CRASHES ? 'failed' : 'crashed', error: reason, crashes });
  }

  /** After a call timed out: a worker that does not answer a ping is hung. */
  private checkAlive(generation: number): void {
    const worker = this.worker;
    if (!worker || generation !== this.generation) return;
    this.rpc
      .request(id => worker.postMessage({ t: 'ping', id } satisfies HostToWorker), this.options.pingTimeoutMs ?? 3_000)
      .catch(err => {
        if (err instanceof PluginRpcError && err.kind === 'timeout') this.crash(generation, 'the plugin stopped responding');
      });
  }

  private onMessage(generation: number, worker: WorkerLike, data: unknown): void {
    if (generation !== this.generation) return;
    const message = parseWorkerMessage(data);
    if (!message) return;
    switch (message.t) {
      case 'result':
        this.rpc.settle(message.id, message.ok ? { ok: true, value: message.value } : { ok: false, error: message.error });
        return;
      case 'pong':
        this.rpc.settle(message.id, { ok: true, value: null });
        return;
      case 'log':
        this.options.onLog?.(message.level, message.args);
        return;
      case 'registered':
        return;
      case 'host': {
        const manifest = this.manifest;
        if (!manifest) return;
        const reply = (outcome: { ok: true; value: unknown } | { ok: false; error: string }) => {
          if (generation !== this.generation) return;
          worker.postMessage({ t: 'reply', id: message.id, ...outcome } as HostToWorker);
        };
        handleHostCall({ manifest, backend: this.options.backend, notifyLimiter: this.notifyLimiter }, message.method, message.args)
          .then(value => reply({ ok: true, value }))
          .catch(err => reply({ ok: false, error: err instanceof HostCallError || err instanceof Error ? err.message : String(err) }));
        return;
      }
    }
  }
}
