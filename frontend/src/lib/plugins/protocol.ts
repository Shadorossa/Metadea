// Messages between the plugin host (this page) and a plugin's worker. The
// worker side is sdk-bootstrap.js. Everything a worker posts is untrusted:
// parseWorkerMessage drops anything that does not have the expected shape.

import type { PluginEventName } from './manifest';

/** Extension points a host → worker `call` can target (extension-points.ts). */
export type ExtensionPointName = 'sources' | 'workActions' | 'workPanels';

export type HostMethod = 'http.fetch' | 'storage.get' | 'storage.set' | 'notify';
export const HOST_METHODS: readonly HostMethod[] = ['http.fetch', 'storage.get', 'storage.set', 'notify'];

export type LogLevel = 'info' | 'warn' | 'error';

export type HostToWorker =
  | { t: 'call'; id: number; point: ExtensionPointName; target: string; method?: string; args: unknown[] }
  | { t: 'event'; name: PluginEventName; payload: unknown }
  | { t: 'reply'; id: number; ok: true; value: unknown }
  | { t: 'reply'; id: number; ok: false; error: string }
  | { t: 'ping'; id: number };

export type WorkerToHost =
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  | { t: 'host'; id: number; method: HostMethod; args: unknown[] }
  | { t: 'log'; level: LogLevel; args: string[] }
  | { t: 'registered'; contributions: Record<string, string[]> }
  | { t: 'pong'; id: number };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

export function parseWorkerMessage(data: unknown): WorkerToHost | null {
  if (!isRecord(data)) return null;
  switch (data.t) {
    case 'result':
      if (!isId(data.id)) return null;
      if (data.ok === true) return { t: 'result', id: data.id, ok: true, value: data.value };
      return { t: 'result', id: data.id, ok: false, error: typeof data.error === 'string' ? data.error.slice(0, 2000) : 'error' };
    case 'host':
      if (!isId(data.id) || !HOST_METHODS.includes(data.method as HostMethod) || !Array.isArray(data.args)) return null;
      return { t: 'host', id: data.id, method: data.method as HostMethod, args: data.args };
    case 'log': {
      const level: LogLevel = data.level === 'warn' || data.level === 'error' ? data.level : 'info';
      const args = Array.isArray(data.args) ? data.args.slice(0, 20).map(a => String(a).slice(0, 2000)) : [];
      return { t: 'log', level, args };
    }
    case 'registered': {
      if (!isRecord(data.contributions)) return null;
      const contributions: Record<string, string[]> = {};
      for (const [point, ids] of Object.entries(data.contributions)) {
        if (Array.isArray(ids)) contributions[point] = ids.filter((id): id is string => typeof id === 'string').slice(0, 64);
      }
      return { t: 'registered', contributions };
    }
    case 'pong':
      return isId(data.id) ? { t: 'pong', id: data.id } : null;
    default:
      return null;
  }
}
