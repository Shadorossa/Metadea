// The app's PluginRuntime, wired to Tauri: plugin_list / plugin_read_entry
// for loading, plugin_http_fetch and plugin_storage_* behind the worker SDK,
// the OS notification wrapper behind `metadea.notify`, and Blob-URL workers.
import { PluginRuntime } from './plugin-runtime';
import { createBlobWorker } from './worker-source';
import { PLUGINS_CHANGED_EVENT, type PluginsChangedDetail } from './host-events';
import { listPlugins, pluginHttpFetch, pluginStorageGet, pluginStorageSet, readPluginEntry } from '../tauri/plugins';
import { notifySystem } from '../notifications/notifications';

let runtime: PluginRuntime | null = null;

export function getPluginRuntime(): PluginRuntime {
  if (runtime) return runtime;
  const instance = new PluginRuntime({
    listPlugins,
    loadEntry: readPluginEntry,
    backend: {
      httpFetch: pluginHttpFetch,
      storageGet: pluginStorageGet,
      storageSet: pluginStorageSet,
      notify: async (_pluginId, title, body) => { await notifySystem(title, body); },
    },
    createWorker: createBlobWorker,
  });
  if (typeof window !== 'undefined') {
    window.addEventListener(PLUGINS_CHANGED_EVENT, event => {
      const detail = (event as CustomEvent<PluginsChangedDetail>).detail ?? {};
      instance.stop(detail.pluginId);
      instance.refresh().catch(() => {});
    });
  }
  runtime = instance;
  return instance;
}
