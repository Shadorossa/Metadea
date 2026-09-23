// Deep links into /settings (see components/settings/mount/tabs.ts, which
// reads `?tab=` and `?platform=`). The ids mirror the `data-tab` buttons in
// pages/settings.astro and the `data-platform` buttons in
// components/settings/EnvironmentTab.astro; settings-tabs.test.ts reads those
// files so a renamed tab breaks the test instead of the guide's buttons.

export const SETTINGS_TAB_IDS = [
  'profile',
  'preferences',
  'application',
  'environment',
  'emulators',
  'accessibility',
  'backup',
  'plugins',
] as const;

export type SettingsTabId = typeof SETTINGS_TAB_IDS[number];

export const SERVICE_PLATFORM_IDS = [
  'igdb',
  'tmdb',
  'steam',
  'anilist',
  'mal',
  'comicvine',
  'apisports',
  'retroachievements',
  'google',
] as const;

export type ServicePlatformId = typeof SERVICE_PLATFORM_IDS[number];

export interface SettingsTarget {
  tab: SettingsTabId;
  /** Only meaningful with `tab: 'environment'`: opens that service's form. */
  platform?: ServicePlatformId;
}

export function settingsHref(target: SettingsTarget): string {
  const params = new URLSearchParams({ tab: target.tab });
  if (target.platform) params.set('platform', target.platform);
  return `/settings?${params.toString()}`;
}

/** Brand names, shown untranslated (they are proper nouns, like the logos in EnvironmentTab). */
export const SERVICE_BRAND_NAMES: Record<ServicePlatformId, string> = {
  igdb: 'IGDB',
  tmdb: 'TMDB',
  steam: 'Steam',
  anilist: 'AniList',
  mal: 'MyAnimeList',
  comicvine: 'Comic Vine',
  apisports: 'API-Sports',
  retroachievements: 'RetroAchievements',
  google: 'Google Drive',
};

/** i18n path of each tab's sidebar label in pages/settings.astro. */
export const SETTINGS_TAB_LABEL_KEYS: Record<SettingsTabId, string> = {
  profile: 'settings.section_appearance',
  preferences: 'settings.tab_preferences',
  application: 'settings.tab_application',
  environment: 'settings.tab_environment',
  emulators: 'settings.tab_emulators',
  accessibility: 'settings.tab_accessibility',
  backup: 'settings.tab_backup',
  plugins: 'plugins.tab',
};
