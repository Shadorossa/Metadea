// IPC surface of src-tauri/src/plugins (docs/PLUGINS.md). Not to be confused
// with ./ui-themes.ts (CSS skins, the "Themes" section of Settings › Plugins).
import { invoke, tauriCmd } from './bridge';
import type { PluginManifest } from '../plugins/manifest';

export interface PluginInfo {
  id: string;
  version: string;
  enabled: boolean;
  /** Unix seconds. */
  installedAt: number;
  updatedAt: number;
  /** null when the package on disk cannot be read (see `error`). */
  manifest: PluginManifest | null;
  iconDataUrl: string | null;
  /** Permission tokens: `host:<pattern>`, `settingsHost:<key>`, `cap:<name>`. */
  grantedPermissions: string[];
  /** Declared on disk but never granted: the plugin will not start. */
  pendingPermissions: string[];
  folder: string;
  /** `E_PLUGIN_*` code (with detail) when the package cannot be loaded. */
  error: string | null;
}

export interface PluginInstallPreview {
  token: string;
  manifest: PluginManifest;
  iconDataUrl: string | null;
  previous: { version: string; grantedPermissions: string[] } | null;
  requestedPermissions: string[];
  newPermissions: string[];
  needsConsent: boolean;
}

export interface PluginEntry {
  source: string;
  manifest: PluginManifest;
  settings: Record<string, unknown>;
}

export interface PluginSettingsView {
  values: Record<string, unknown>;
  secretsSet: string[];
}

export interface PluginHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  bodyBase64?: string;
  responseType?: 'text' | 'base64';
  timeoutMs?: number;
}

export interface PluginHttpResponse {
  status: number;
  url: string;
  headers: Record<string, string>;
  body: string;
  bodyEncoding: 'text' | 'base64';
}

export interface PluginWorkLink {
  pluginId: string;
  sourceId: string;
  itemId: string;
  itemTitle: string;
}

export function listPlugins(): Promise<PluginInfo[]> {
  return tauriCmd<PluginInfo[]>('plugin_list', []);
}

/** Opens the zip picker when `path` is omitted; null when the user cancels. */
export function installPluginFromFile(path?: string): Promise<PluginInstallPreview | null> {
  return invoke<PluginInstallPreview | null>('plugin_install_from_file', { path: path ?? null });
}

export function installPluginFromUrl(url: string): Promise<PluginInstallPreview> {
  return invoke<PluginInstallPreview>('plugin_install_from_url', { url });
}

export function confirmPluginInstall(token: string): Promise<PluginInfo> {
  return invoke<PluginInfo>('plugin_install_confirm', { token });
}

export function cancelPluginInstall(token: string): Promise<void> {
  return invoke<void>('plugin_install_cancel', { token });
}

export function grantPluginPermissions(id: string): Promise<void> {
  return invoke<void>('plugin_grant_permissions', { id });
}

export function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke<void>('plugin_set_enabled', { id, enabled });
}

export function uninstallPlugin(id: string): Promise<void> {
  return invoke<void>('plugin_uninstall', { id });
}

export function readPluginEntry(id: string): Promise<PluginEntry> {
  return invoke<PluginEntry>('plugin_read_entry', { id });
}

export function openPluginsFolder(): Promise<void> {
  return invoke<void>('plugin_open_folder');
}

export function getPluginSettings(id: string, includeSecrets = false): Promise<PluginSettingsView> {
  return invoke<PluginSettingsView>('plugin_get_settings', { id, includeSecrets });
}

/** Omit a secret key to keep its stored value; send '' to clear it. */
export function setPluginSettings(id: string, values: Record<string, unknown>): Promise<void> {
  return invoke<void>('plugin_set_settings', { id, values });
}

export function pluginHttpFetch(id: string, request: PluginHttpRequest): Promise<PluginHttpResponse> {
  return invoke<PluginHttpResponse>('plugin_http_fetch', { id, request });
}

/** Downloads a chapter archive into the app cache; returns its path. */
export function pluginHttpDownload(id: string, request: PluginHttpRequest, extension: string): Promise<string> {
  return invoke<string>('plugin_http_download', { id, request, extension });
}

export function pluginStorageGet(id: string, key: string): Promise<string | null> {
  return invoke<string | null>('plugin_storage_get', { id, key });
}

export function pluginStorageSet(id: string, key: string, value: string | null): Promise<void> {
  return invoke<void>('plugin_storage_set', { id, key, value });
}

export function getPluginWorkLink(externalId: string): Promise<PluginWorkLink | null> {
  return tauriCmd<PluginWorkLink | null>('plugin_get_work_link', null, { externalId });
}

export function setPluginWorkLink(externalId: string, link: PluginWorkLink | null): Promise<void> {
  return invoke<void>('plugin_set_work_link', { externalId, link });
}
