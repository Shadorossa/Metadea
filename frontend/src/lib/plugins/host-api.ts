// What a plugin worker may ask of the host (`metadea.http`, `.storage`,
// `.notify`). Arguments come from untrusted code, so each call is shape-
// checked here before it reaches Rust, which enforces the real limits
// (granted hosts, storage quota) again. `notify` needs the `notifications`
// capability and is rate-limited per plugin.
import type { PluginManifest } from './manifest';
import type { HostMethod } from './protocol';
import type { PluginHttpRequest, PluginHttpResponse } from '../tauri/plugins';

/** Side effects the host API performs; the runtime wires Tauri + the app. */
export interface PluginHostBackend {
  httpFetch(pluginId: string, request: PluginHttpRequest): Promise<PluginHttpResponse>;
  storageGet(pluginId: string, key: string): Promise<string | null>;
  storageSet(pluginId: string, key: string, value: string | null): Promise<void>;
  notify(pluginId: string, title: string, body: string): Promise<void>;
}

export const NOTIFY_BURST = 3;
export const NOTIFY_REFILL_MS = 60_000;

/** Token bucket: `burst` notifications at once, one more per `refillMs`. */
export class RateLimiter {
  private tokens: number;
  private last: number;

  constructor(private readonly burst: number, private readonly refillMs: number, private readonly now: () => number = Date.now) {
    this.tokens = burst;
    this.last = now();
  }

  take(): boolean {
    const now = this.now();
    this.tokens = Math.min(this.burst, this.tokens + (now - this.last) / this.refillMs);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export class HostCallError extends Error {}

const MAX_KEY = 256;

function requireString(value: unknown, what: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new HostCallError(`${what} must be a string of 1-${max} characters`);
  return value;
}

function httpRequestFrom(value: unknown): PluginHttpRequest {
  if (typeof value !== 'object' || value === null) throw new HostCallError('http.fetch expects a request object');
  const raw = value as Record<string, unknown>;
  const request: PluginHttpRequest = { url: requireString(raw.url, 'url', 8192) };
  if (raw.method !== undefined) request.method = requireString(raw.method, 'method', 16);
  if (raw.headers !== undefined) {
    if (typeof raw.headers !== 'object' || raw.headers === null || Array.isArray(raw.headers)) throw new HostCallError('headers must be an object');
    const headers: Record<string, string> = {};
    for (const [name, v] of Object.entries(raw.headers)) {
      if (typeof v !== 'string') throw new HostCallError(`header ${name} must be a string`);
      headers[name] = v;
    }
    request.headers = headers;
  }
  if (raw.body !== undefined) {
    if (typeof raw.body !== 'string') throw new HostCallError('body must be a string (use bodyBase64 for bytes)');
    request.body = raw.body;
  }
  if (raw.bodyBase64 !== undefined) request.bodyBase64 = requireString(raw.bodyBase64, 'bodyBase64', 8 * 1024 * 1024);
  if (raw.responseType !== undefined) {
    if (raw.responseType !== 'text' && raw.responseType !== 'base64') throw new HostCallError('responseType must be "text" or "base64"');
    request.responseType = raw.responseType;
  }
  if (raw.timeoutMs !== undefined) {
    if (typeof raw.timeoutMs !== 'number' || !Number.isFinite(raw.timeoutMs)) throw new HostCallError('timeoutMs must be a number');
    request.timeoutMs = Math.round(raw.timeoutMs);
  }
  return request;
}

export interface HostApiContext {
  manifest: PluginManifest;
  backend: PluginHostBackend;
  notifyLimiter: RateLimiter;
}

export async function handleHostCall(ctx: HostApiContext, method: HostMethod, args: unknown[]): Promise<unknown> {
  const id = ctx.manifest.id;
  switch (method) {
    case 'http.fetch':
      return ctx.backend.httpFetch(id, httpRequestFrom(args[0]));
    case 'storage.get':
      return ctx.backend.storageGet(id, requireString(args[0], 'key', MAX_KEY));
    case 'storage.set': {
      const key = requireString(args[0], 'key', MAX_KEY);
      const value = args[1];
      if (value !== null && typeof value !== 'string') throw new HostCallError('storage value must be JSON text');
      await ctx.backend.storageSet(id, key, value);
      return null;
    }
    case 'notify': {
      if (!ctx.manifest.permissions.capabilities.includes('notifications')) {
        throw new HostCallError('the "notifications" capability was not granted');
      }
      if (!ctx.notifyLimiter.take()) throw new HostCallError('too many notifications; try again later');
      const title = String(args[0] ?? '').slice(0, 100).trim();
      const body = String(args[1] ?? '').slice(0, 300).trim();
      if (!title && !body) throw new HostCallError('notify needs a title or a body');
      await ctx.backend.notify(id, `${ctx.manifest.name}: ${title}`.slice(0, 140), body);
      return null;
    }
  }
}
