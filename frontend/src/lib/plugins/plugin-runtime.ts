// The plugin runtime: which plugins are installed and runnable, one
// PluginWorkerHost per plugin (created on first use), typed calls into
// extension points, and event fan-out. One instance per page context
// (getPluginRuntime), so it survives Astro page transitions like the other
// module-level stores.
import type { PluginInfo } from '../tauri/plugins';
import type { PluginEventName, SourceContribution, WorkContribution } from './manifest';
import { contributionsFor, EXTENSION_CALLS, type ExtensionCallKey, type ExtensionResult } from './extension-points';
import { PluginWorkerHost, type PluginEntryData, type PluginWorkerStatus } from './plugin-worker-host';
import type { PluginHostBackend } from './host-api';
import type { WorkerFactory } from './worker-source';
import { PluginResultError } from './plugin-results';
import { createExternalStore, type ExternalStore } from '../shared/state/external-store';

export interface PluginRuntimeDeps {
  listPlugins: () => Promise<PluginInfo[]>;
  loadEntry: (pluginId: string) => Promise<PluginEntryData>;
  backend: PluginHostBackend;
  createWorker: WorkerFactory;
  now?: () => number;
}

export interface PluginLogLine {
  level: 'info' | 'warn' | 'error';
  message: string;
  at: number;
}

const MAX_LOG_LINES = 50;

/** Installed, enabled, loadable and fully consented. */
export function isRunnable(plugin: PluginInfo): boolean {
  return plugin.enabled && !!plugin.manifest && !plugin.error && plugin.pendingPermissions.length === 0;
}

export class PluginRuntime {
  readonly plugins: ExternalStore<PluginInfo[]> = createExternalStore<PluginInfo[]>([]);
  readonly statuses: ExternalStore<Record<string, PluginWorkerStatus>> = createExternalStore<Record<string, PluginWorkerStatus>>({});
  private readonly hosts = new Map<string, PluginWorkerHost>();
  private readonly logs = new Map<string, PluginLogLine[]>();
  private loading: Promise<PluginInfo[]> | null = null;
  private loaded = false;

  constructor(private readonly deps: PluginRuntimeDeps) {}

  /** Re-reads the installed plugins; stops workers of plugins that can no longer run. */
  refresh(): Promise<PluginInfo[]> {
    if (this.loading) return this.loading;
    this.loading = this.deps.listPlugins().then(
      list => {
        this.loading = null;
        this.loaded = true;
        for (const [id, host] of this.hosts) {
          const info = list.find(p => p.id === id);
          if (!info || !isRunnable(info)) {
            host.stop();
            this.hosts.delete(id);
          }
        }
        this.plugins.set(list);
        return list;
      },
      err => {
        this.loading = null;
        throw err;
      },
    );
    return this.loading;
  }

  /** The list, loading it once. */
  async ensureLoaded(): Promise<PluginInfo[]> {
    return this.loaded ? this.plugins.get() : this.refresh();
  }

  runnable(): PluginInfo[] {
    return this.plugins.get().filter(isRunnable);
  }

  /** Every source of a runnable plugin that serves `workType`. */
  sourcesFor(workType: string): Array<{ plugin: PluginInfo; source: SourceContribution }> {
    return this.runnable().flatMap(plugin =>
      (plugin.manifest?.contributes.sources ?? [])
        .filter(source => (source.types as string[]).includes(workType))
        .map(source => ({ plugin, source })),
    );
  }

  contributionsFor(point: 'workActions' | 'workPanels', workType: string): Array<{ plugin: PluginInfo; item: WorkContribution }> {
    return this.runnable().flatMap(plugin =>
      plugin.manifest ? contributionsFor(plugin.manifest.contributes, point, workType).map(item => ({ plugin, item })) : [],
    );
  }

  private host(pluginId: string): PluginWorkerHost {
    let host = this.hosts.get(pluginId);
    if (!host) {
      host = new PluginWorkerHost({
        pluginId,
        loadEntry: this.deps.loadEntry,
        backend: this.deps.backend,
        createWorker: this.deps.createWorker,
        now: this.deps.now,
        onStatus: status => this.statuses.set({ ...this.statuses.get(), [pluginId]: status }),
        onLog: (level, args) => this.log(pluginId, level, args.join(' ')),
      });
      this.hosts.set(pluginId, host);
    }
    return host;
  }

  private log(pluginId: string, level: PluginLogLine['level'], message: string): void {
    const lines = this.logs.get(pluginId) ?? [];
    lines.push({ level, message, at: (this.deps.now ?? Date.now)() });
    if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES);
    this.logs.set(pluginId, lines);
    if (level === 'error') console.warn(`[plugin ${pluginId}] ${message}`);
  }

  logsOf(pluginId: string): readonly PluginLogLine[] {
    return this.logs.get(pluginId) ?? [];
  }

  /**
   * Calls one contribution handler and returns its normalised result.
   * Refuses plugins that are not runnable (disabled plugins never start)
   * and contributions the manifest does not declare.
   */
  async invoke<K extends ExtensionCallKey>(pluginId: string, key: K, target: string, args: unknown[]): Promise<ExtensionResult<K>> {
    const plugin = (await this.ensureLoaded()).find(p => p.id === pluginId);
    if (!plugin || !isRunnable(plugin) || !plugin.manifest) throw new PluginResultError(`plugin ${pluginId} is not enabled`);
    const call = EXTENSION_CALLS[key];
    const declared = call.point === 'sources'
      ? plugin.manifest.contributes.sources.find(s => s.id === target)
      : plugin.manifest.contributes[call.point].find(c => c.id === target);
    if (!declared) throw new PluginResultError(`${pluginId} does not declare ${call.point}.${target}`);
    const label = 'label' in declared ? declared.label : declared.name;
    const raw = await this.host(pluginId).call(call.point, target, call.method, args, call.timeoutMs);
    try {
      return call.sanitize(raw, { label }) as ExtensionResult<K>;
    } catch (err) {
      this.log(pluginId, 'error', `${key} returned an invalid result: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  /** Delivers a read-only event to every runnable plugin that subscribes to it. */
  async emit(name: PluginEventName, payload: unknown): Promise<void> {
    const plugins = await this.ensureLoaded().catch(() => [] as PluginInfo[]);
    for (const plugin of plugins) {
      if (isRunnable(plugin) && plugin.manifest?.contributes.events.includes(name)) {
        void this.host(plugin.id).dispatchEvent(name, payload);
      }
    }
  }

  /** Stops one plugin's worker (or all); the next use starts a fresh one. */
  stop(pluginId?: string): void {
    for (const [id, host] of this.hosts) {
      if (pluginId === undefined || id === pluginId) {
        host.stop();
        this.hosts.delete(id);
      }
    }
  }

  statusOf(pluginId: string): PluginWorkerStatus | undefined {
    return this.statuses.get()[pluginId];
  }
}
