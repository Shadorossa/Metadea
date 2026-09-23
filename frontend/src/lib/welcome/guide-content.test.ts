import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { es } from '../../i18n/es';
import { de } from '../../i18n/de';
import { ja } from '../../i18n/ja';
import { it as itLocale } from '../../i18n/it';
import { fr } from '../../i18n/fr';
import { ca } from '../../i18n/ca';
import { ru } from '../../i18n/ru';
import { resolveTranslationKey } from '../i18n-dom/apply-translations';
import { parseShortcut } from '../shared/keyboard/shortcut-keys';
import {
  GUIDE_GROUP_IDS, GUIDE_ROUTES, GUIDE_SECTIONS, groupSections, sectionAnchor, sectionSearchText,
  type GuideSectionCopy,
} from './guide-content';
import {
  SERVICE_PLATFORM_IDS, SETTINGS_TAB_IDS, SETTINGS_TAB_LABEL_KEYS, settingsHref,
} from './settings-tabs';

const LOCALES = [
  ['en', en], ['es', es], ['de', de], ['ja', ja], ['it', itLocale], ['fr', fr], ['ca', ca], ['ru', ru],
] as const;

// Raw sources through Vite, so the checks read the real markup the deep links land on.
const sources = import.meta.glob(['../../pages/*.astro', '../../components/settings/EnvironmentTab.astro'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;
const settingsPage = sources['../../pages/settings.astro'] ?? '';
const environmentTab = sources['../../components/settings/EnvironmentTab.astro'] ?? '';

const sectionIds = GUIDE_SECTIONS.map(section => section.id);

describe('guide content map', () => {
  it('has unique section ids and anchors', () => {
    expect(new Set(sectionIds).size).toBe(sectionIds.length);
    expect(new Set(sectionIds.map(sectionAnchor)).size).toBe(sectionIds.length);
  });

  it('puts at least one section in every group', () => {
    expect(groupSections().map(entry => entry.group)).toEqual([...GUIDE_GROUP_IDS]);
  });

  it('has exactly the sections the reference locale documents', () => {
    expect(Object.keys(en.guide.sections).sort()).toEqual([...sectionIds].sort());
    expect(Object.keys(en.guide.groups).sort()).toEqual([...GUIDE_GROUP_IDS].sort());
  });

  it('only lists key specs the shortcut parser understands', () => {
    const platform = { isMac: false };
    for (const section of GUIDE_SECTIONS) {
      for (const shortcut of ('shortcuts' in section ? section.shortcuts : [])) {
        for (const spec of shortcut.keys) expect(parseShortcut(spec, platform).key, `${section.id}: ${spec}`).not.toBe('');
      }
    }
  });

  it('builds searchable text from every part of a section', () => {
    const copy: GuideSectionCopy = { title: 'T', intro: 'I', steps: { s1: 'S' }, tips: { t1: 'P' } };
    expect(sectionSearchText(copy, ['G'])).toBe('T I S P G');
  });
});

describe.each(LOCALES)('guide copy in %s', (_name, locale) => {
  it('gives every section a title, an intro, steps and tips', () => {
    for (const id of sectionIds) {
      const copy = (locale.guide.sections as Record<string, GuideSectionCopy | undefined>)[id];
      expect(copy, id).toBeDefined();
      if (!copy) continue;
      expect(copy.title.trim(), `${id}.title`).not.toBe('');
      expect(copy.intro.trim(), `${id}.intro`).not.toBe('');
      const lines = [...Object.values(copy.steps), ...Object.values(copy.tips)];
      expect(Object.keys(copy.steps).length, `${id}.steps`).toBeGreaterThan(0);
      expect(Object.keys(copy.tips).length, `${id}.tips`).toBeGreaterThan(0);
      for (const line of lines) expect(line.trim(), id).not.toBe('');
    }
  });

  it('resolves every shortcut description, settings tab and page name', () => {
    const labels = [
      ...GUIDE_SECTIONS.flatMap(section => ('shortcuts' in section ? section.shortcuts.map(s => s.label) : [])),
      ...Object.values(SETTINGS_TAB_LABEL_KEYS),
      ...Object.values(GUIDE_ROUTES).map(route => route.label),
    ];
    for (const label of labels) expect(resolveTranslationKey(locale, label), label).toBeTypeOf('string');
  });
});

describe('guide deep links', () => {
  it('only targets settings tabs that exist in pages/settings.astro', () => {
    for (const tab of SETTINGS_TAB_IDS) expect(settingsPage, tab).toContain(`data-tab="${tab}"`);
    for (const section of GUIDE_SECTIONS) {
      for (const target of ('settings' in section ? section.settings : [])) {
        expect(SETTINGS_TAB_IDS as readonly string[], section.id).toContain(target.tab);
      }
    }
  });

  it('only opens service forms that exist in the Environment tab', () => {
    for (const platform of SERVICE_PLATFORM_IDS) {
      expect(environmentTab, platform).toContain(`data-platform="${platform}"`);
      expect(environmentTab, platform).toContain(`id="api-form-${platform}"`);
    }
    for (const section of GUIDE_SECTIONS) {
      for (const target of ('settings' in section ? section.settings : [])) {
        if ('platform' in target) expect(target.tab, section.id).toBe('environment');
      }
    }
  });

  it('only links to pages that exist', () => {
    for (const route of Object.values(GUIDE_ROUTES)) {
      expect(Object.keys(sources), route.href).toContain(`../../pages${route.href}.astro`);
    }
  });

  it('encodes the settings query string the tabs module reads', () => {
    expect(settingsHref({ tab: 'emulators' })).toBe('/settings?tab=emulators');
    expect(settingsHref({ tab: 'environment', platform: 'retroachievements' }))
      .toBe('/settings?tab=environment&platform=retroachievements');
  });
});
