// In-process stand-in for a dedicated Worker, for the runtime tests (vitest
// runs in node, without Web Workers). It runs the exact composed script the
// real worker gets — SDK bootstrap plus plugin code — against a fake global
// scope, with structured-clone message passing on separate macrotasks.
import type { WorkerFactory, WorkerLike } from '../../src/lib/plugins/worker-source';

export interface TestWorkerOptions {
  /** Stop delivering messages once the script has run (a busy-looping worker). */
  hang?: boolean;
}

export interface TestWorkerRecord {
  name: string;
  worker: WorkerLike;
  terminated: () => boolean;
}

export function createTestWorkerFactory(options: TestWorkerOptions = {}): { factory: WorkerFactory; created: TestWorkerRecord[] } {
  const created: TestWorkerRecord[] = [];
  const factory: WorkerFactory = (source, name) => {
    const listeners: Array<(event: { data: unknown }) => void> = [];
    let terminated = false;
    let loaded = false;
    const adapter: WorkerLike = {
      postMessage(message) {
        if (terminated) return;
        const copy = structuredClone(message);
        setTimeout(() => {
          if (terminated || (options.hang && loaded)) return;
          for (const listener of listeners) listener({ data: copy });
        }, 0);
      },
      terminate() {
        terminated = true;
      },
      onmessage: null,
      onerror: null,
    };
    // What a WorkerGlobalScope offers that the bootstrap must take away.
    const scope: Record<string, unknown> = {
      postMessage(message: unknown) {
        if (terminated) return;
        const copy = structuredClone(message);
        setTimeout(() => {
          if (!terminated) adapter.onmessage?.({ data: copy });
        }, 0);
      },
      addEventListener(type: string, listener: (event: { data: unknown }) => void) {
        if (type === 'message') listeners.push(listener);
      },
      fetch: () => Promise.resolve('network'),
      XMLHttpRequest: class {},
      WebSocket: class {},
      indexedDB: {},
      importScripts: () => undefined,
    };
    setTimeout(() => {
      if (terminated) return;
      try {
        // Test-only: node has no Worker; the real app runs this source from a
        // Blob URL. `with` makes free identifiers (fetch, indexedDB…) resolve
        // against the fake scope, as they would against a worker's global.
        new Function('self', `with (self) {\n${source}\n}`)(scope);
        loaded = true;
      } catch (err) {
        adapter.onerror?.({ message: err instanceof Error ? err.message : String(err) });
      }
    }, 0);
    created.push({ name, worker: adapter, terminated: () => terminated });
    return adapter;
  };
  return { factory, created };
}
