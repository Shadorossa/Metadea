// Integration tests of the plugin runtime: the real SDK bootstrap and the
// example plugin (plugins/examples/hello-source) run in an in-process test
// worker, driven through PluginRuntime exactly as the app drives them.
import { describe, expect, it, vi } from 'vitest';
import helloSource from '../../../plugins/examples/hello-source/main.js?raw';
import helloManifestJson from '../../../plugins/examples/hello-source/manifest.json?raw';
import { PluginRuntime, type PluginRuntimeDeps } from '../../src/lib/plugins/plugin-runtime';
import { crashBackoffMs, MAX_CRASHES, BACKOFF_MAX_MS, PluginWorkerHost } from '../../src/lib/plugins/plugin-worker-host';
import { validatePluginManifest, type PluginManifest } from '../../src/lib/plugins/manifest';
import { PluginRpcError } from '../../src/lib/plugins/rpc';
import type { PluginInfo, PluginHttpRequest } from '../../src/lib/tauri/plugins';
import type { PluginHostBackend } from '../../src/lib/plugins/host-api';
import { createTestWorkerFactory, type TestWorkerOptions } from './test-worker';

function helloManifest(): PluginManifest {
  const result = validatePluginManifest(JSON.parse(helloManifestJson));
  if (!result.ok) throw new Error(result.error);
  return result.manifest;
}

function manifestWith(id: string, patch: Partial<PluginManifest> = {}): PluginManifest {
  const base = helloManifest();
  return { ...base, id, name: id, ...patch };
}

function info(manifest: PluginManifest, overrides: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id: manifest.id,
    version: manifest.version,
    enabled: true,
    installedAt: 0,
    updatedAt: 0,
    manifest,
    iconDataUrl: null,
    grantedPermissions: [],
    pendingPermissions: [],
    folder: '',
    error: null,
    ...overrides,
  };
}

function defaults(manifest: PluginManifest): Record<string, unknown> {
  return Object.fromEntries(manifest.settings.filter(f => f.default !== undefined).map(f => [f.key, f.default]));
}

interface Setup {
  plugins: Array<{ info: PluginInfo; source: string }>;
  worker?: TestWorkerOptions;
  backend?: Partial<PluginHostBackend>;
  now?: () => number;
}

function setup({ plugins, worker, backend, now }: Setup) {
  const storage = new Map<string, string>();
  const fetches: Array<{ pluginId: string; request: PluginHttpRequest }> = [];
  const notifications: string[] = [];
  const { factory, created } = createTestWorkerFactory(worker);
  const loadEntry = vi.fn(async (id: string) => {
    const plugin = plugins.find(p => p.info.id === id);
    // Mirrors plugin_read_entry: Rust refuses disabled plugins.
    if (!plugin || !plugin.info.enabled) throw 'E_PLUGIN_DISABLED: ' + id;
    const manifest = plugin.info.manifest as PluginManifest;
    return { source: plugin.source, manifest, settings: defaults(manifest) };
  });
  const deps: PluginRuntimeDeps = {
    listPlugins: async () => plugins.map(p => p.info),
    loadEntry,
    createWorker: factory,
    now,
    backend: {
      httpFetch: async (pluginId, request) => {
        fetches.push({ pluginId, request });
        throw 'E_PLUGIN_HOST_NOT_ALLOWED: ' + new URL(request.url).host;
      },
      storageGet: async (pluginId, key) => storage.get(`${pluginId}/${key}`) ?? null,
      storageSet: async (pluginId, key, value) => {
        if (value === null) storage.delete(`${pluginId}/${key}`);
        else storage.set(`${pluginId}/${key}`, value);
      },
      notify: async (_pluginId, title, body) => { notifications.push(`${title}|${body}`); },
      ...backend,
    },
  };
  return { runtime: new PluginRuntime(deps), storage, fetches, notifications, created, loadEntry };
}

const WORK = { externalId: 'manga:118586', type: 'manga', titles: ['Some Title'], anilistId: 118586, malId: null, year: 2020 };

describe('hello-source through the runtime', () => {
  it('serves every extension point', async () => {
    const manifest = helloManifest();
    const { runtime, storage } = setup({ plugins: [{ info: info(manifest), source: helloSource }] });
    await runtime.refresh();
    expect(runtime.sourcesFor('manga').map(s => s.source.id)).toEqual(['hello']);
    expect(runtime.sourcesFor('anime')).toEqual([]);

    const search = await runtime.invoke(manifest.id, 'sources.search', 'hello', ['journey', 1]);
    expect(search.items[0]).toMatchObject({ id: 'hello-1', anilistId: 118586, type: 'manga' });
    expect(search.items[0].cover).toMatch(/^data:image\/svg\+xml,/);

    const details = await runtime.invoke(manifest.id, 'sources.details', 'hello', ['hello-1']);
    expect(details.chapters).toHaveLength(6);
    expect(details.chapters[1]).toMatchObject({ id: 'hello-1:2', number: 2, volume: 1 });

    const pages = await runtime.invoke(manifest.id, 'sources.pages', 'hello', ['hello-1:2']);
    expect(pages.kind).toBe('images');
    if (pages.kind === 'images') expect(pages.pages).toHaveLength(4);
    expect(storage.get(`${manifest.id}/reads`)).toBe('1');

    const action = await runtime.invoke(manifest.id, 'workActions.run', 'say-hello', [{ ...WORK, titles: ['Reader'] }]);
    expect(action).toEqual({ type: 'toast', message: 'Hello, Reader!', level: 'success' });

    const panel = await runtime.invoke(manifest.id, 'workPanels.render', 'hello-panel', [WORK]);
    expect(panel?.title).toBe('Hello Source');
    expect(panel?.rows.find(r => r.label === 'Chapters opened here')?.value).toBe('1');
    expect(panel?.badges).toEqual(['AniList #118586']);

    await runtime.emit('progress.changed', { externalId: 'manga:118586', type: 'manga', number: 3 });
    await vi.waitFor(() => expect(storage.get(`${manifest.id}/progress:manga:118586`)).toContain('"number":3'));
    runtime.stop();
  });

  it('refuses contributions the manifest does not declare', async () => {
    const manifest = helloManifest();
    const { runtime } = setup({ plugins: [{ info: info(manifest), source: helloSource }] });
    await expect(runtime.invoke(manifest.id, 'sources.search', 'other', ['x', 1])).rejects.toThrow(/does not declare/);
  });
});

describe('isolation', () => {
  it('removes network and storage globals before the plugin runs', async () => {
    const manifest = helloManifest();
    const probe = `metadea.register({ workActions: { 'say-hello': async () => ({ type: 'toast', message: [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof indexedDB, typeof importScripts, typeof self.fetch].join(',') }) } });`;
    const { runtime } = setup({ plugins: [{ info: info(manifest), source: probe }] });
    const result = await runtime.invoke(manifest.id, 'workActions.run', 'say-hello', [WORK]);
    expect(result).toMatchObject({ message: 'undefined,undefined,undefined,undefined,undefined,undefined' });
    runtime.stop();
  });

  it('routes metadea.http.fetch through the host with the plugin id, and surfaces refusals', async () => {
    const manifest = helloManifest();
    const code = `metadea.register({ workActions: { 'say-hello': async () => {
      try { await metadea.http.fetch('https://example.org/x', { headers: { A: '1' } }); return { type: 'toast', message: 'fetched' }; }
      catch (e) { return { type: 'toast', message: e.message }; }
    } } });`;
    const { runtime, fetches } = setup({ plugins: [{ info: info(manifest), source: code }] });
    const result = await runtime.invoke(manifest.id, 'workActions.run', 'say-hello', [WORK]);
    expect(result).toMatchObject({ message: 'E_PLUGIN_HOST_NOT_ALLOWED: example.org' });
    expect(fetches).toEqual([{ pluginId: manifest.id, request: { url: 'https://example.org/x', headers: { A: '1' } } }]);
    runtime.stop();
  });

  it('never starts a disabled plugin', async () => {
    const manifest = helloManifest();
    const { runtime, created, loadEntry } = setup({ plugins: [{ info: info(manifest, { enabled: false }), source: helloSource }] });
    await runtime.refresh();
    expect(runtime.sourcesFor('manga')).toEqual([]);
    await expect(runtime.invoke(manifest.id, 'sources.search', 'hello', ['x', 1])).rejects.toThrow(/not enabled/);
    await runtime.emit('progress.changed', { externalId: 'manga:1', number: 1 });
    expect(loadEntry).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('never starts a plugin with permissions waiting for consent', async () => {
    const manifest = helloManifest();
    const { runtime, created } = setup({ plugins: [{ info: info(manifest, { pendingPermissions: ['host:cdn.example.com'] }), source: helloSource }] });
    await expect(runtime.invoke(manifest.id, 'sources.search', 'hello', ['x', 1])).rejects.toThrow(/not enabled/);
    expect(created).toHaveLength(0);
  });

  it('keeps one crashing plugin from affecting another', async () => {
    const good = helloManifest();
    const bad = manifestWith('com.example.crashy');
    const { runtime } = setup({
      plugins: [
        { info: info(good), source: helloSource },
        { info: info(bad), source: 'throw new Error("boom at load");' },
      ],
    });
    await expect(runtime.invoke(bad.id, 'sources.search', 'hello', ['x', 1])).rejects.toBeInstanceOf(PluginRpcError);
    expect(runtime.statusOf(bad.id)).toMatchObject({ state: 'crashed', crashes: 1, error: expect.stringContaining('boom at load') });
    const search = await runtime.invoke(good.id, 'sources.search', 'hello', ['sample', 1]);
    expect(search.items.map(i => i.id)).toEqual(['hello-3']);
    expect(runtime.statusOf(good.id)?.state).toBe('running');
    runtime.stop();
  });

  it('rejects a handler error without crashing the worker', async () => {
    const manifest = helloManifest();
    const { runtime } = setup({ plugins: [{ info: info(manifest), source: helloSource }] });
    await expect(runtime.invoke(manifest.id, 'sources.details', 'hello', ['nope'])).rejects.toThrow('Unknown work nope');
    expect(runtime.statusOf(manifest.id)?.state).toBe('running');
    runtime.stop();
  });

  it('rejects an invalid result', async () => {
    const manifest = helloManifest();
    const code = `metadea.register({ sources: { hello: { search: async () => 'not a list' } } });`;
    const { runtime } = setup({ plugins: [{ info: info(manifest), source: code }] });
    await expect(runtime.invoke(manifest.id, 'sources.search', 'hello', ['x', 1])).rejects.toThrow(/search must return/);
    runtime.stop();
  });
});

describe('timeouts and restarts', () => {
  const entry = (source: string) => ({ source, manifest: helloManifest(), settings: {} });

  it('times out a slow call but keeps a responsive worker', async () => {
    const { factory } = createTestWorkerFactory();
    const host = new PluginWorkerHost({
      pluginId: 'org.metadea.examples.hello-source',
      loadEntry: async () => entry(`metadea.register({ workActions: { 'say-hello': () => new Promise(() => {}) } });`),
      backend: {} as PluginHostBackend,
      createWorker: factory,
      pingTimeoutMs: 200,
    });
    const error: unknown = await host.call('workActions', 'say-hello', undefined, [], 50).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PluginRpcError);
    expect((error as PluginRpcError).kind).toBe('timeout');
    await new Promise(r => setTimeout(r, 250));
    expect(host.getStatus().state).toBe('running');
    host.stop();
  });

  it('restarts a hung worker after a backoff', async () => {
    let clock = 1_000;
    const { factory, created } = createTestWorkerFactory({ hang: true });
    const host = new PluginWorkerHost({
      pluginId: 'org.metadea.examples.hello-source',
      loadEntry: async () => entry(helloSource),
      backend: {} as PluginHostBackend,
      createWorker: factory,
      pingTimeoutMs: 30,
      now: () => clock,
    });
    await expect(host.call('sources', 'hello', 'search', ['x', 1], 30)).rejects.toMatchObject({ kind: 'timeout' });
    await vi.waitFor(() => expect(host.getStatus()).toMatchObject({ state: 'crashed', crashes: 1 }));
    expect(created[0].terminated()).toBe(true);
    // Still backing off: refused without starting a worker.
    await expect(host.call('sources', 'hello', 'search', ['x', 1], 30)).rejects.toThrow(/restarting in/);
    expect(created).toHaveLength(1);
    clock += crashBackoffMs(1);
    await expect(host.call('sources', 'hello', 'search', ['x', 1], 30)).rejects.toMatchObject({ kind: 'timeout' });
    expect(created).toHaveLength(2);
    host.stop();
  });

  it('gives up after MAX_CRASHES and backs off exponentially', async () => {
    expect([1, 2, 3, 4].map(crashBackoffMs)).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(crashBackoffMs(20)).toBe(BACKOFF_MAX_MS);
    let clock = 0;
    const { factory } = createTestWorkerFactory();
    const host = new PluginWorkerHost({
      pluginId: 'com.example.crashy',
      loadEntry: async () => entry('throw new Error("boom");'),
      backend: {} as PluginHostBackend,
      createWorker: factory,
      now: () => clock,
    });
    for (let i = 1; i <= MAX_CRASHES; i += 1) {
      await host.call('workActions', 'say-hello', undefined, []).catch(() => undefined);
      clock += BACKOFF_MAX_MS;
    }
    expect(host.getStatus()).toMatchObject({ state: 'failed', crashes: MAX_CRASHES });
    await expect(host.call('workActions', 'say-hello', undefined, [])).rejects.toThrow('boom');
    host.stop();
    expect(host.getStatus()).toMatchObject({ state: 'idle', crashes: 0 });
  });
});

describe('notifications', () => {
  const code = `metadea.register({ workActions: { 'say-hello': async () => {
    const out = [];
    for (let i = 0; i < 4; i++) { try { await metadea.notify('T' + i, 'B'); out.push('ok'); } catch (e) { out.push(e.message); } }
    return { type: 'toast', message: out.join('|') };
  } } });`;

  it('needs the notifications capability', async () => {
    const manifest = helloManifest();
    const { runtime, notifications } = setup({ plugins: [{ info: info(manifest), source: code }] });
    const result = await runtime.invoke(manifest.id, 'workActions.run', 'say-hello', [WORK]);
    expect(result).toMatchObject({ message: expect.stringContaining('"notifications" capability was not granted') });
    expect(notifications).toEqual([]);
    runtime.stop();
  });

  it('is rate-limited and prefixed with the plugin name', async () => {
    const manifest = { ...helloManifest(), permissions: { hosts: [], settingsHosts: [], capabilities: ['notifications' as const] } };
    const { runtime, notifications } = setup({ plugins: [{ info: info(manifest), source: code }], now: () => 0 });
    const result = await runtime.invoke(manifest.id, 'workActions.run', 'say-hello', [WORK]);
    expect(result).toMatchObject({ message: 'ok|ok|ok|too many notifications; try again later' });
    expect(notifications).toEqual(['Hello Source: T0|B', 'Hello Source: T1|B', 'Hello Source: T2|B']);
    runtime.stop();
  });
});
