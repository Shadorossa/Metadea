// Builds the script a plugin worker runs, and the default way to start it.
//
// The worker is created from a Blob URL (CSP: `worker-src 'self' blob:`),
// so nothing is evaluated in the page. The script is one classic worker
// script: the SDK bootstrap, called with the plugin's config, then the
// plugin's own main.js wrapped in a function that receives `metadea`.
import bootstrapSource from './sdk-bootstrap.js?raw';

export interface WorkerBootConfig {
  id: string;
  version: string;
  settings: Record<string, unknown>;
}

export function composeWorkerSource(pluginSource: string, config: WorkerBootConfig): string {
  return [
    `${bootstrapSource.trim()}(self, ${JSON.stringify(config)});`,
    '(function (metadea) {',
    pluginSource,
    '}).call(undefined, self.metadea);',
    `//# sourceURL=metadea-plugin/${encodeURIComponent(config.id)}/${encodeURIComponent(config.version)}/main.js`,
  ].join('\n');
}

/** The part of `Worker` the host uses; tests supply an in-process fake. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null;
}

export type WorkerFactory = (source: string, name: string) => WorkerLike;

/** Real dedicated worker from a Blob URL (revoked once it has loaded). */
export const createBlobWorker: WorkerFactory = (source, name) => {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url, { name, type: 'classic' });
  // Revoking right away can race the worker's own fetch of the script.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  const adapter: WorkerLike = {
    postMessage: message => worker.postMessage(message),
    terminate: () => {
      worker.terminate();
      URL.revokeObjectURL(url);
    },
    onmessage: null,
    onerror: null,
  };
  worker.onmessage = event => adapter.onmessage?.({ data: event.data });
  worker.onmessageerror = () => adapter.onerror?.({ message: 'unreadable message from the plugin worker' });
  worker.onerror = event => adapter.onerror?.({ message: event.message, preventDefault: () => event.preventDefault() });
  return adapter;
};
