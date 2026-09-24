// Plugin manifest (`manifest.json`) — the TypeScript mirror of
// src-tauri/src/plugins/manifest.rs. Rust is the authority (it validates on
// install and on every load); this validator lets the frontend type what it
// receives and is kept honest by the shared case table
// src-tauri/src/fixtures/plugins/manifest-cases.json, run by both test suites.
// Public reference: docs/PLUGINS.md.

export const SUPPORTED_API_VERSIONS = [1] as const;

export const PLUGIN_CAPABILITIES = ['notifications', 'openUrl'] as const;
export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number];

export const PLUGIN_EVENTS = ['library.changed', 'progress.changed', 'session.ended'] as const;
export type PluginEventName = (typeof PLUGIN_EVENTS)[number];

export const SOURCE_TYPES = ['manga', 'comic', 'lnovel', 'book'] as const;
export type SourceWorkType = (typeof SOURCE_TYPES)[number];

export const WORK_TYPES = ['anime', 'manga', 'lnovel', 'book', 'comic', 'movie', 'series', 'game', 'vn', 'event'] as const;

export type SettingType = 'string' | 'secret' | 'number' | 'boolean' | 'select' | 'url';

export interface SettingOption { value: string; label: string }

export interface SettingField {
  key: string;
  type: SettingType;
  label: string;
  description?: string;
  default?: unknown;
  required?: boolean;
  options?: SettingOption[];
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface PluginPermissions {
  hosts: string[];
  settingsHosts: string[];
  capabilities: PluginCapability[];
}

export interface SourceContribution { id: string; name: string; types: SourceWorkType[]; language?: string }
export interface WorkContribution { id: string; label: string; types: string[] }

export interface PluginContributions {
  sources: SourceContribution[];
  workActions: WorkContribution[];
  workPanels: WorkContribution[];
  events: PluginEventName[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  author: string;
  description: string;
  icon?: string;
  main: string;
  permissions: PluginPermissions;
  settings: SettingField[];
  contributes: PluginContributions;
}

export type ManifestResult =
  | { ok: true; manifest: PluginManifest }
  | { ok: false; code: 'E_PLUGIN_MANIFEST_INVALID' | 'E_PLUGIN_API_UNSUPPORTED'; error: string };

const MAX = {
  id: 100, name: 64, author: 64, description: 500, version: 32, hosts: 32, settings: 32,
  selectOptions: 64, contributions: 16, label: 80, help: 300, settingString: 4096,
};

class ManifestError extends Error {}

function fail(message: string): never {
  throw new ManifestError(message);
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function onlyKeys(obj: Json, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) fail(`unknown field "${key}" in ${where}`);
  }
}

function optStr(obj: Json, key: string, where: string): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(`"${key}" in ${where} must be a string`);
  return value;
}

function str(obj: Json, key: string, where: string): string {
  const value = optStr(obj, key, where);
  if (value === undefined) fail(`missing field "${key}" in ${where}`);
  return value;
}

function arr(obj: Json, key: string, where: string): unknown[] {
  const value = obj[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(`"${key}" in ${where} must be an array`);
  return value;
}

function strings(obj: Json, key: string, where: string): string[] {
  return arr(obj, key, where).map(item => {
    if (typeof item !== 'string') fail(`"${key}" in ${where} must hold strings`);
    return item;
  });
}

function boundedText(field: string, value: string, max: number, required: boolean): void {
  if (required && value.trim() === '') fail(`${field} is empty`);
  if ([...value].length > max) fail(`${field} is longer than ${max} characters`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(value)) fail(`${field} contains control characters`);
}

function unique(what: string, ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(`duplicate ${what} "${id}"`);
    seen.add(id);
  }
}

export function isValidPluginId(id: string): boolean {
  if (!id || id.length > MAX.id) return false;
  const labels = id.split('.');
  if (labels.length < 2 || !/^[a-z]/.test(labels[0])) return false;
  return labels.every(label => /^[a-z0-9-]{1,63}$/.test(label) && !label.startsWith('-') && !label.endsWith('-'));
}

export function isValidVersion(version: string): boolean {
  if (!version || version.length > MAX.version) return false;
  const dash = version.indexOf('-');
  const core = dash === -1 ? version : version.slice(0, dash);
  const pre = dash === -1 ? null : version.slice(dash + 1);
  const parts = core.split('.');
  const coreOk = parts.length === 3 && parts.every(p => /^(0|[1-9][0-9]*)$/.test(p));
  const preOk = pre === null || /^[0-9A-Za-z.-]+$/.test(pre);
  return coreOk && preOk;
}

const isContributionId = (id: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
const isSettingKey = (key: string) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key);

/** Relative path inside the package, with one of `extensions`. */
function isRelativeFile(path: string, extensions: string[]): boolean {
  if (!path || path.includes('\0') || path.includes(':')) return false;
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return false;
  const parts = normalized.split('/').filter(p => p !== '' && p !== '.');
  if (parts.length === 0 || parts.includes('..')) return false;
  const ext = parts[parts.length - 1].split('.').pop()?.toLowerCase() ?? '';
  return parts[parts.length - 1].includes('.') && extensions.includes(ext);
}

const isHostnameLabel = (label: string) => /^[A-Za-z0-9-]{1,63}$/.test(label) && !label.startsWith('-') && !label.endsWith('-');
const isIpv4 = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host.split('.').every(o => Number(o) <= 255 && (o === '0' || !o.startsWith('0')));

/** Syntax check of a `permissions.hosts` pattern (host_rules.rs). Returns an error or null. */
export function hostPatternError(input: string): string | null {
  const pattern = input.trim();
  if (!pattern) return 'empty host';
  if (/:\/\/|[/@?]/.test(pattern)) return 'write the host only, without a scheme, path or credentials';
  const wildcard = pattern.startsWith('*.');
  const rest = wildcard ? pattern.slice(2) : pattern;
  let host: string;
  let port: string | null = null;
  let isV6 = false;
  if (rest.startsWith('[')) {
    const end = rest.indexOf(']');
    if (end === -1) return 'unclosed [ in IPv6 host';
    host = rest.slice(1, end).toLowerCase();
    if (!/^[0-9a-f:.]+$/.test(host) || (host.match(/:/g) ?? []).length < 2) return 'invalid IPv6 address';
    isV6 = true;
    const after = rest.slice(end + 1);
    if (after) {
      if (!after.startsWith(':')) return 'unexpected text after ]';
      port = after.slice(1);
    }
  } else {
    const colon = rest.lastIndexOf(':');
    if (colon === -1) {
      host = rest.toLowerCase();
    } else {
      host = rest.slice(0, colon).toLowerCase();
      if (host.includes(':')) return 'IPv6 hosts must be written in brackets';
      port = rest.slice(colon + 1);
    }
  }
  if (host.includes('*')) return '"*" is only allowed as a leading "*." or as the port';
  if (port !== null && port !== '*') {
    const n = Number(port);
    if (!/^[1-9][0-9]{0,4}$/.test(port) || n > 65535) return `invalid port "${port}"`;
  }
  const isIp = isV6 || isIpv4(host);
  if (!isIp && (host.length > 253 || !host.split('.').every(isHostnameLabel))) return 'invalid host name';
  if (wildcard) {
    if (isIp || host === 'localhost') return 'wildcards cannot apply to IP addresses or localhost';
    if (host.split('.').length < 2) return 'a wildcard needs at least two labels after "*."';
  }
  return null;
}

function checkUrlValue(value: string): string | null {
  if (value === '') return null;
  let url: URL;
  try { url = new URL(value); } catch { return 'not a valid URL'; }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return 'expected an http(s) URL';
  if (url.username || url.password) return 'credentials in the URL are not allowed; use a secret setting';
  return null;
}

/** Whether `value` fits `field` (settings.rs `check_value`). Returns an error or null. */
export function settingValueError(field: SettingField, value: unknown): string | null {
  switch (field.type) {
    case 'string':
    case 'secret':
      if (typeof value !== 'string') return 'expected a string';
      return new TextEncoder().encode(value).length > MAX.settingString ? `longer than ${MAX.settingString} bytes` : null;
    case 'url':
      return typeof value === 'string' ? checkUrlValue(value) : 'expected a string';
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'expected a number';
      if ((field.min != null && value < field.min) || (field.max != null && value > field.max)) return 'out of range';
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? null : 'expected true or false';
    case 'select':
      if (typeof value !== 'string') return 'expected a string';
      return field.options?.some(o => o.value === value) ? null : `"${value}" is not one of the options`;
  }
}

const SETTING_TYPES: SettingType[] = ['string', 'secret', 'number', 'boolean', 'select', 'url'];

function parseSetting(raw: unknown): SettingField {
  if (!isObject(raw)) fail('a setting must be an object');
  onlyKeys(raw, ['key', 'type', 'label', 'description', 'default', 'required', 'options', 'min', 'max', 'placeholder'], 'setting');
  const key = str(raw, 'key', 'setting');
  const type = str(raw, 'type', 'setting') as SettingType;
  if (!SETTING_TYPES.includes(type)) fail(`unknown setting type "${type}"`);
  const label = str(raw, 'label', 'setting');
  const field: SettingField = { key, type, label };
  if (!isSettingKey(key)) fail(`setting key "${key}" must match [A-Za-z][A-Za-z0-9_]* (64 max)`);
  boundedText('setting label', label, MAX.label, true);
  const description = optStr(raw, 'description', 'setting');
  if (description !== undefined) { boundedText('setting description', description, MAX.help, false); field.description = description; }
  const placeholder = optStr(raw, 'placeholder', 'setting');
  if (placeholder !== undefined) { boundedText('setting placeholder', placeholder, MAX.label, false); field.placeholder = placeholder; }
  if (raw.required !== undefined) {
    if (typeof raw.required !== 'boolean') fail('"required" must be a boolean');
    field.required = raw.required;
  }
  for (const bound of ['min', 'max'] as const) {
    if (raw[bound] !== undefined) {
      if (typeof raw[bound] !== 'number') fail(`"${bound}" must be a number`);
      field[bound] = raw[bound] as number;
    }
  }
  const options = arr(raw, 'options', 'setting').map(option => {
    if (!isObject(option)) fail('a select option must be an object');
    onlyKeys(option, ['value', 'label'], 'option');
    return { value: str(option, 'value', 'option'), label: str(option, 'label', 'option') };
  });
  if (type === 'select') {
    if (options.length === 0 || options.length > MAX.selectOptions) fail(`select setting "${key}" needs 1 to ${MAX.selectOptions} options`);
    unique('option', options.map(o => o.value));
    for (const option of options) {
      boundedText('option value', option.value, MAX.label, true);
      boundedText('option label', option.label, MAX.label, true);
    }
    field.options = options;
  } else if (options.length > 0) {
    fail(`setting "${key}" has options but is not a select`);
  }
  if (type !== 'number' && (field.min !== undefined || field.max !== undefined)) fail(`setting "${key}" has min/max but is not a number`);
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail(`setting "${key}" has min > max`);
  if ('default' in raw && raw.default !== undefined) {
    if (type === 'secret') fail(`secret setting "${key}" cannot have a default`);
    const error = settingValueError(field, raw.default);
    if (error) fail(`default of "${key}": ${error}`);
    field.default = raw.default;
  }
  return field;
}

function checkTypes(what: string, types: string[], allowed: readonly string[], required: boolean): void {
  if (required && types.length === 0) fail(`${what} needs at least one type`);
  for (const type of types) if (!allowed.includes(type)) fail(`${what} has unknown type "${type}"`);
  unique('type', types);
}

function parseWorkContributions(raw: Json, key: 'workActions' | 'workPanels'): WorkContribution[] {
  const list = arr(raw, key, 'contributes').map(item => {
    if (!isObject(item)) fail(`a ${key} entry must be an object`);
    onlyKeys(item, ['id', 'label', 'types'], key);
    const entry = { id: str(item, 'id', key), label: str(item, 'label', key), types: strings(item, 'types', key) };
    if (!isContributionId(entry.id)) fail(`${key} id "${entry.id}" must match [a-z0-9-]+`);
    boundedText(`${key} label`, entry.label, MAX.label, true);
    checkTypes(`${key} "${entry.id}"`, entry.types, WORK_TYPES, false);
    return entry;
  });
  if (list.length > MAX.contributions) fail(`more than ${MAX.contributions} ${key}`);
  unique(`${key} id`, list.map(item => item.id));
  return list;
}

function parseContributions(raw: unknown): PluginContributions {
  if (raw === undefined) return { sources: [], workActions: [], workPanels: [], events: [] };
  if (!isObject(raw)) fail('"contributes" must be an object');
  onlyKeys(raw, ['sources', 'workActions', 'workPanels', 'events'], 'contributes');
  const sources = arr(raw, 'sources', 'contributes').map(item => {
    if (!isObject(item)) fail('a source must be an object');
    onlyKeys(item, ['id', 'name', 'types', 'language'], 'source');
    const source: SourceContribution = {
      id: str(item, 'id', 'source'),
      name: str(item, 'name', 'source'),
      types: strings(item, 'types', 'source') as SourceWorkType[],
    };
    if (!isContributionId(source.id)) fail(`source id "${source.id}" must match [a-z0-9-]+`);
    boundedText('source name', source.name, MAX.label, true);
    checkTypes(`source "${source.id}"`, source.types, SOURCE_TYPES, true);
    const language = optStr(item, 'language', 'source');
    if (language !== undefined) {
      if (!/^[A-Za-z-]{2,8}$/.test(language)) fail(`source "${source.id}" has an invalid language tag`);
      source.language = language;
    }
    return source;
  });
  if (sources.length > MAX.contributions) fail(`more than ${MAX.contributions} sources`);
  unique('source id', sources.map(s => s.id));
  const workActions = parseWorkContributions(raw, 'workActions');
  const workPanels = parseWorkContributions(raw, 'workPanels');
  const events = strings(raw, 'events', 'contributes');
  for (const event of events) if (!(PLUGIN_EVENTS as readonly string[]).includes(event)) fail(`unknown event "${event}"`);
  unique('event', events);
  return { sources, workActions, workPanels, events: events as PluginEventName[] };
}

function parsePermissions(raw: unknown, settings: SettingField[]): PluginPermissions {
  if (raw === undefined) return { hosts: [], settingsHosts: [], capabilities: [] };
  if (!isObject(raw)) fail('"permissions" must be an object');
  onlyKeys(raw, ['hosts', 'settingsHosts', 'capabilities'], 'permissions');
  const hosts = strings(raw, 'hosts', 'permissions');
  if (hosts.length > MAX.hosts) fail(`more than ${MAX.hosts} hosts`);
  for (const host of hosts) {
    const error = hostPatternError(host);
    if (error) fail(`host "${host}": ${error}`);
  }
  unique('host', hosts);
  const settingsHosts = strings(raw, 'settingsHosts', 'permissions');
  for (const key of settingsHosts) {
    if (!settings.some(f => f.key === key && f.type === 'url')) fail(`settingsHosts entry "${key}" is not a url setting`);
  }
  unique('settingsHosts entry', settingsHosts);
  const capabilities = strings(raw, 'capabilities', 'permissions');
  for (const cap of capabilities) if (!(PLUGIN_CAPABILITIES as readonly string[]).includes(cap)) fail(`unknown capability "${cap}"`);
  unique('capability', capabilities);
  return { hosts, settingsHosts, capabilities: capabilities as PluginCapability[] };
}

/** Validates a parsed `manifest.json` value. */
export function validatePluginManifest(raw: unknown): ManifestResult {
  try {
    if (!isObject(raw)) fail('manifest must be a JSON object');
    if ('apiVersion' in raw && !(SUPPORTED_API_VERSIONS as readonly unknown[]).includes(raw.apiVersion)) {
      return { ok: false, code: 'E_PLUGIN_API_UNSUPPORTED', error: String(raw.apiVersion) };
    }
    onlyKeys(raw, ['id', 'name', 'version', 'apiVersion', 'author', 'description', 'icon', 'main', 'permissions', 'settings', 'contributes'], 'manifest');
    const id = str(raw, 'id', 'manifest');
    const name = str(raw, 'name', 'manifest');
    const version = str(raw, 'version', 'manifest');
    if (raw.apiVersion === undefined) fail('missing field "apiVersion" in manifest');
    const author = str(raw, 'author', 'manifest');
    const description = optStr(raw, 'description', 'manifest') ?? '';
    const icon = optStr(raw, 'icon', 'manifest');
    const main = str(raw, 'main', 'manifest');
    if (!isValidPluginId(id)) fail(`id "${id}" must be reverse-DNS (e.g. com.example.my-plugin)`);
    if (!isValidVersion(version)) fail(`version "${version}" must be MAJOR.MINOR.PATCH`);
    boundedText('name', name, MAX.name, true);
    boundedText('author', author, MAX.author, true);
    boundedText('description', description, MAX.description, false);
    if (!isRelativeFile(main, ['js'])) fail(`main "${main}" must be a relative .js path inside the package`);
    if (icon !== undefined && !isRelativeFile(icon, ['png', 'svg', 'webp', 'jpg', 'jpeg'])) {
      fail(`icon "${icon}" must be a relative png/svg/webp/jpg path inside the package`);
    }
    const settings = arr(raw, 'settings', 'manifest').map(parseSetting);
    if (settings.length > MAX.settings) fail(`more than ${MAX.settings} settings`);
    unique('setting key', settings.map(s => s.key));
    const permissions = parsePermissions(raw.permissions, settings);
    const contributes = parseContributions(raw.contributes);
    return {
      ok: true,
      manifest: { id, name, version, apiVersion: raw.apiVersion as number, author, description, ...(icon ? { icon } : {}), main, permissions, settings, contributes },
    };
  } catch (err) {
    if (err instanceof ManifestError) return { ok: false, code: 'E_PLUGIN_MANIFEST_INVALID', error: err.message };
    throw err;
  }
}
