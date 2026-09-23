import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { resolveTranslationKey } from '../i18n-dom/apply-translations';
import { ONBOARDING_STEPS } from './onboarding-steps';
import { GUIDE_SECTIONS } from './guide-content';
import { SERVICE_BRAND_NAMES, SERVICE_PLATFORM_IDS, SETTINGS_TAB_IDS, SETTINGS_TAB_LABEL_KEYS, settingsHref } from './settings-tabs';

// Raw markup, so the ids are checked against what the sidebar really renders.
const sources = import.meta.glob(['../../pages/settings.astro', '../../components/settings/PluginsTab.astro'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const settingsPage = sources['../../pages/settings.astro'] ?? '';
const pluginsTab = sources['../../components/settings/PluginsTab.astro'] ?? '';

describe('settings tab ids', () => {
  it('lists the sidebar tabs in order, Plugins after Backup', () => {
    expect([...SETTINGS_TAB_IDS]).toEqual(['profile', 'preferences', 'application', 'environment', 'emulators', 'accessibility', 'backup', 'plugins']);
    const backup = settingsPage.indexOf('data-tab="backup"');
    const plugins = settingsPage.indexOf('data-tab="plugins"');
    const catalogEditor = settingsPage.indexOf('id="settings-admin-link"');
    expect(backup).toBeGreaterThan(catalogEditor);
    expect(plugins).toBeGreaterThan(backup);
  });

  it('gives every tab a sidebar label that exists', () => {
    for (const tab of SETTINGS_TAB_IDS) {
      expect(resolveTranslationKey(en, SETTINGS_TAB_LABEL_KEYS[tab]), tab).toBeTypeOf('string');
    }
    expect(SETTINGS_TAB_LABEL_KEYS.plugins).toBe('plugins.tab');
  });

  it('hosts the UI themes in the Plugins panel', () => {
    expect(pluginsTab).toContain('id="panel-plugins"');
    expect(pluginsTab).toContain('<UiThemesSection');
  });

  it('points the skins guide and onboarding step at Plugins', () => {
    const guide = GUIDE_SECTIONS.find(section => section.id === 'ui_themes');
    expect(guide && 'settings' in guide ? guide.settings : []).toEqual([{ tab: 'plugins' }]);
    expect(ONBOARDING_STEPS.find(step => step.id === 'ui_theme')?.settingsTab).toBe('plugins');
    expect(settingsHref({ tab: 'plugins' })).toBe('/settings?tab=plugins');
  });

  it('names the Google Drive client form', () => {
    expect(SERVICE_PLATFORM_IDS).toContain('google');
    expect(SERVICE_BRAND_NAMES.google).toBe('Google Drive');
    expect(settingsHref({ tab: 'environment', platform: 'google' })).toBe('/settings?tab=environment&platform=google');
  });
});
