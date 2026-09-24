import { describe, expect, it } from 'vitest';
import cases from '../../../src-tauri/src/fixtures/plugins/manifest-cases.json';
import helloManifest from '../../../../plugins/examples/hello-source/manifest.json?raw';
import { hostPatternError, isValidPluginId, isValidVersion, settingValueError, validatePluginManifest } from './manifest';

describe('validatePluginManifest', () => {
  // The same table manifest.rs runs: both validators must agree.
  it.each(cases as Array<{ name: string; manifest: unknown; valid: boolean; code?: string }>)('$name', testCase => {
    const result = validatePluginManifest(testCase.manifest);
    expect(result.ok, result.ok ? '' : result.error).toBe(testCase.valid);
    if (!result.ok && testCase.code) expect(result.code).toBe(testCase.code);
  });

  it('accepts the example plugin', () => {
    const result = validatePluginManifest(JSON.parse(helloManifest));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.contributes.sources[0].id).toBe('hello');
      expect(result.manifest.permissions).toEqual({ hosts: [], settingsHosts: [], capabilities: [] });
    }
  });

  it('fills defaults for optional sections', () => {
    const result = validatePluginManifest({ id: 'a.b', name: 'N', version: '1.0.0', apiVersion: 1, author: 'A', main: 'm.js' });
    expect(result).toMatchObject({
      ok: true,
      manifest: { description: '', settings: [], permissions: { hosts: [] }, contributes: { sources: [], events: [] } },
    });
  });
});

describe('field rules', () => {
  it('ids and versions', () => {
    expect(isValidPluginId('org.metadea.examples.hello-source')).toBe(true);
    expect(isValidPluginId('hello')).toBe(false);
    expect(isValidPluginId('.a.b')).toBe(false);
    expect(isValidVersion('1.2.3-rc.1')).toBe(true);
    expect(isValidVersion('1.02.3')).toBe(false);
  });

  it('host patterns', () => {
    for (const ok of ['example.com', '*.example.com:8443', 'localhost:4567', '192.168.1.5:*', '[::1]:80']) expect(hostPatternError(ok), ok).toBeNull();
    for (const bad of ['*', '*.com', 'https://x.com', 'x.com/a', 'a*b.com', '*.localhost', 'x.com:0', 'x.com:70000']) expect(hostPatternError(bad), bad).not.toBeNull();
  });

  it('setting values', () => {
    expect(settingValueError({ key: 'u', type: 'url', label: 'U' }, 'http://nas:4567')).toBeNull();
    expect(settingValueError({ key: 'u', type: 'url', label: 'U' }, 'https://user:pw@x.org')).not.toBeNull();
    expect(settingValueError({ key: 'n', type: 'number', label: 'N', min: 1, max: 3 }, 4)).toBe('out of range');
    expect(settingValueError({ key: 's', type: 'select', label: 'S', options: [{ value: 'a', label: 'A' }] }, 'b')).not.toBeNull();
    expect(settingValueError({ key: 'b', type: 'boolean', label: 'B' }, 'true')).not.toBeNull();
  });
});
