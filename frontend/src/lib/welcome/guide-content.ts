// Structure of the in-app user guide (/guide, components/guide/GuideView.tsx).
// The prose lives in i18n (`guide.sections.<id>.{title,intro,steps,tips}`) so
// every locale translates it; this map only adds what is not text: grouping,
// icon, the settings tab a section's "Open settings" button deep-links to,
// the page it can open and the shortcuts it lists. guide-content.test.ts checks
// that the map and every locale agree, and that each deep-link target exists.

import type { SettingsTarget } from './settings-tabs';

export const GUIDE_GROUP_IDS = [
  'start',
  'discover',
  'library',
  'play',
  'watch',
  'integrations',
  'customize',
  'data',
] as const;

export type GuideGroupId = typeof GUIDE_GROUP_IDS[number];

export type GuideIcon =
  | 'compass' | 'map' | 'user' | 'house' | 'search' | 'film' | 'pencil' | 'repeat' | 'layers'
  | 'users' | 'git' | 'list' | 'star' | 'heart' | 'trophy' | 'chart' | 'bell' | 'folder'
  | 'monitor' | 'gamepad' | 'download' | 'award' | 'camera' | 'rocket' | 'play' | 'keyboard'
  | 'skip' | 'book' | 'book-text' | 'music' | 'key' | 'refresh' | 'link' | 'message'
  | 'palette' | 'paintbrush' | 'globe' | 'shield' | 'database' | 'sparkles';

export interface GuideShortcut {
  /** Key specs in lib/shared/keyboard/shortcut-keys.ts syntax ('mod+k', 'shift+arrowleft'). */
  keys: readonly string[];
  /** Dotted i18n path of the description (a `shortcuts.*` or `guide.keys.*` string). */
  label: string;
}

export interface GuideSectionDef {
  id: string;
  group: GuideGroupId;
  icon: GuideIcon;
  /** "Open settings" buttons, in display order. */
  settings?: readonly SettingsTarget[];
  /** In-app page the section is about, for an "Open" button. */
  route?: GuideRoute;
  shortcuts?: readonly GuideShortcut[];
}

/** Pages the guide links to, with the i18n key (under `nav`) naming them. */
export const GUIDE_ROUTES = {
  home: { href: '/home', label: 'nav.home' },
  local: { href: '/local', label: 'nav.local' },
  search: { href: '/search', label: 'nav.browse' },
  profile: { href: '/profile', label: 'nav.dropdown_profile' },
  tier: { href: '/tier', label: 'nav.tier' },
  notifications: { href: '/notifications', label: 'nav.notifications' },
} as const;

export type GuideRoute = keyof typeof GUIDE_ROUTES;

const k = (keys: readonly string[], label: string): GuideShortcut => ({ keys, label });

export const GUIDE_SECTIONS = [
  // ── Getting started ─────────────────────────────────────────────────────
  { id: 'overview', group: 'start', icon: 'sparkles', route: 'home' },
  {
    id: 'navigation', group: 'start', icon: 'compass',
    shortcuts: [
      k(['mod+1'], 'shortcuts.go_home'),
      k(['mod+2'], 'shortcuts.go_local'),
      k(['mod+3'], 'shortcuts.go_profile'),
      k(['mod+4'], 'shortcuts.go_search'),
      k(['mod+5'], 'shortcuts.go_notifications'),
      k(['mod+6', 'mod+,'], 'shortcuts.go_settings'),
      k(['alt+arrowleft'], 'shortcuts.history_back'),
      k(['alt+arrowright'], 'shortcuts.history_forward'),
      k(['?'], 'shortcuts.toggle_sheet'),
    ],
  },
  { id: 'account', group: 'start', icon: 'user', settings: [{ tab: 'profile' }] },

  // ── Discover ────────────────────────────────────────────────────────────
  { id: 'home', group: 'discover', icon: 'house', route: 'home' },
  {
    id: 'search', group: 'discover', icon: 'search', route: 'search',
    settings: [{ tab: 'environment' }],
    shortcuts: [
      k(['mod+k', '/'], 'shortcuts.open_quick_search'),
      k(['arrowdown'], 'shortcuts.quick_search_next'),
      k(['arrowup'], 'shortcuts.quick_search_prev'),
      k(['enter'], 'shortcuts.quick_search_open'),
      k(['mod+f'], 'shortcuts.search_focus_input'),
    ],
  },
  {
    id: 'media_page', group: 'discover', icon: 'film',
    shortcuts: [
      k(['e'], 'shortcuts.media_open_editor'),
      k(['f'], 'shortcuts.media_toggle_favorite'),
      k(['+'], 'shortcuts.media_progress_increment'),
      k(['-'], 'shortcuts.media_progress_decrement'),
      k(['1', '0'], 'shortcuts.media_rate'),
      k(['l'], 'shortcuts.media_copy_link'),
      k(['t'], 'shortcuts.media_play_theme'),
    ],
  },
  {
    id: 'editor', group: 'discover', icon: 'pencil',
    shortcuts: [
      k(['mod+s'], 'shortcuts.editor_save'),
      k(['mod+z'], 'shortcuts.editor_undo'),
      k(['mod+y', 'mod+shift+z'], 'shortcuts.editor_redo'),
      k(['mod+tab'], 'shortcuts.editor_next_tab'),
    ],
  },
  { id: 'rewatch', group: 'discover', icon: 'repeat' },
  { id: 'sagas', group: 'discover', icon: 'layers', settings: [{ tab: 'preferences' }] },
  { id: 'characters', group: 'discover', icon: 'users' },
  {
    id: 'community', group: 'discover', icon: 'git',
    settings: [{ tab: 'application' }, { tab: 'novedades' }],
    shortcuts: [k(['p'], 'shortcuts.media_propose')],
  },

  // ── Library & profile ───────────────────────────────────────────────────
  {
    id: 'statuses', group: 'library', icon: 'list', route: 'profile',
    shortcuts: [k(['mod+f'], 'shortcuts.library_focus_search')],
  },
  { id: 'ratings', group: 'library', icon: 'star', settings: [{ tab: 'preferences' }] },
  { id: 'favorites_lists', group: 'library', icon: 'heart', route: 'profile' },
  { id: 'tier_lists', group: 'library', icon: 'trophy', route: 'tier' },
  { id: 'stats', group: 'library', icon: 'chart', route: 'profile' },
  { id: 'social', group: 'library', icon: 'bell', route: 'notifications' },

  // ── Play ────────────────────────────────────────────────────────────────
  {
    id: 'local_folders', group: 'play', icon: 'folder', route: 'local',
    settings: [{ tab: 'environment' }],
    shortcuts: [k(['mod+f'], 'shortcuts.local_focus_search')],
  },
  {
    id: 'pc_launchers', group: 'play', icon: 'monitor', route: 'local',
    settings: [{ tab: 'environment', platform: 'steam' }],
  },
  { id: 'roms', group: 'play', icon: 'gamepad', route: 'local', settings: [{ tab: 'emulators' }] },
  {
    id: 'metadata', group: 'play', icon: 'download', route: 'local',
    settings: [{ tab: 'environment', platform: 'igdb' }, { tab: 'environment', platform: 'steam' }],
  },
  {
    id: 'achievements', group: 'play', icon: 'award', route: 'local',
    settings: [{ tab: 'environment', platform: 'retroachievements' }, { tab: 'environment', platform: 'steam' }],
  },
  {
    id: 'screenshots', group: 'play', icon: 'camera', settings: [{ tab: 'emulators' }],
    shortcuts: [k(['f12'], 'shortcuts.player_screenshot')],
  },
  { id: 'launching', group: 'play', icon: 'rocket', route: 'local', settings: [{ tab: 'emulators' }] },

  // ── Watch, read & listen ────────────────────────────────────────────────
  { id: 'player', group: 'watch', icon: 'play', settings: [{ tab: 'preferences' }] },
  {
    id: 'player_shortcuts', group: 'watch', icon: 'keyboard',
    shortcuts: [
      k(['space'], 'shortcuts.player_toggle_pause'),
      k(['arrowleft'], 'shortcuts.player_seek_back'),
      k(['arrowright'], 'shortcuts.player_seek_forward'),
      k(['shift+arrowleft'], 'shortcuts.player_seek_back_large'),
      k(['shift+arrowright'], 'shortcuts.player_seek_forward_large'),
      k(['arrowup'], 'shortcuts.player_volume_up'),
      k(['arrowdown'], 'shortcuts.player_volume_down'),
      k(['m'], 'shortcuts.player_toggle_mute'),
      k(['f'], 'shortcuts.player_toggle_fullscreen'),
      k(['escape'], 'shortcuts.player_escape'),
      k(['n', 'mod+arrowright'], 'shortcuts.player_next_episode'),
      k(['p', 'mod+arrowleft'], 'shortcuts.player_prev_episode'),
      k(['f12'], 'shortcuts.player_screenshot'),
      k(['j'], 'shortcuts.player_sub_delay_down'),
      k(['k'], 'shortcuts.player_sub_delay_up'),
      k(['q'], 'shortcuts.player_toggle_queue'),
      k(['s'], 'shortcuts.player_skip_segment'),
      k([','], 'shortcuts.player_frame_back'),
      k(['.'], 'shortcuts.player_frame_forward'),
      k(['['], 'shortcuts.player_speed_down'),
      k([']'], 'shortcuts.player_speed_up'),
      k(['c'], 'shortcuts.player_cycle_subtitles'),
      k(['a'], 'shortcuts.player_cycle_audio'),
      k(['0', '9'], 'shortcuts.player_seek_percent'),
      k(['home'], 'shortcuts.player_seek_start'),
      k(['end'], 'shortcuts.player_seek_end'),
    ],
  },
  {
    id: 'skip_segments', group: 'watch', icon: 'skip', settings: [{ tab: 'preferences' }],
    shortcuts: [k(['s'], 'shortcuts.player_skip_segment')],
  },
  {
    id: 'reader_comics', group: 'watch', icon: 'book', route: 'local',
    shortcuts: [
      k(['arrowright', 'space'], 'guide.keys.next_page'),
      k(['arrowleft'], 'guide.keys.prev_page'),
      k(['f11'], 'guide.keys.fullscreen'),
      k(['escape'], 'guide.keys.close_reader'),
    ],
  },
  {
    id: 'reader_epub', group: 'watch', icon: 'book-text', route: 'local',
    shortcuts: [
      k(['arrowright', 'pagedown', 'space'], 'guide.keys.next_page'),
      k(['arrowleft', 'pageup', 'shift+space'], 'guide.keys.prev_page'),
      k(['mod+arrowright'], 'guide.keys.next_chapter'),
      k(['mod+arrowleft'], 'guide.keys.prev_chapter'),
      k(['+', '-'], 'guide.keys.font_size'),
      k(['t'], 'guide.keys.toc'),
      k(['f11'], 'guide.keys.fullscreen'),
    ],
  },
  {
    id: 'themes_jukebox', group: 'watch', icon: 'music',
    shortcuts: [k(['t'], 'shortcuts.media_play_theme')],
  },

  // ── Integrations ────────────────────────────────────────────────────────
  {
    id: 'api_keys', group: 'integrations', icon: 'key',
    settings: [{ tab: 'environment' }],
  },
  {
    id: 'anilist', group: 'integrations', icon: 'refresh',
    settings: [{ tab: 'environment', platform: 'anilist' }, { tab: 'application' }],
  },
  {
    id: 'myanimelist', group: 'integrations', icon: 'refresh',
    settings: [{ tab: 'environment', platform: 'mal' }, { tab: 'application' }],
  },
  {
    id: 'retroachievements', group: 'integrations', icon: 'trophy',
    settings: [{ tab: 'environment', platform: 'retroachievements' }],
  },
  { id: 'discord', group: 'integrations', icon: 'message' },
  {
    id: 'deep_links', group: 'integrations', icon: 'link',
    shortcuts: [k(['l'], 'shortcuts.media_copy_link')],
  },
  { id: 'github', group: 'integrations', icon: 'git', settings: [{ tab: 'application' }] },

  // ── Customization ───────────────────────────────────────────────────────
  { id: 'appearance', group: 'customize', icon: 'palette', settings: [{ tab: 'profile' }] },
  {
    id: 'ui_themes', group: 'customize', icon: 'paintbrush', settings: [{ tab: 'profile' }],
    shortcuts: [k(['mod+shift+t'], 'shortcuts.ui_theme_deactivate')],
  },
  { id: 'language', group: 'customize', icon: 'globe', settings: [{ tab: 'preferences' }] },
  {
    id: 'shortcuts', group: 'customize', icon: 'keyboard', settings: [{ tab: 'preferences' }],
    shortcuts: [k(['?'], 'shortcuts.toggle_sheet')],
  },

  // ── Data & privacy ──────────────────────────────────────────────────────
  { id: 'privacy', group: 'data', icon: 'shield', settings: [{ tab: 'environment' }] },
  { id: 'backup', group: 'data', icon: 'database', settings: [{ tab: 'backup' }] },
  { id: 'updates', group: 'data', icon: 'download', settings: [{ tab: 'novedades' }] },
] as const satisfies readonly GuideSectionDef[];

export type GuideSectionId = typeof GUIDE_SECTIONS[number]['id'];

/** Sections grouped for the table of contents, groups in GUIDE_GROUP_IDS order. */
export function groupSections(
  sections: readonly GuideSectionDef[] = GUIDE_SECTIONS,
): Array<{ group: GuideGroupId; sections: GuideSectionDef[] }> {
  return GUIDE_GROUP_IDS
    .map(group => ({ group, sections: sections.filter(section => section.group === group) }))
    .filter(entry => entry.sections.length > 0);
}

/** Anchor id of a section on the guide page (`/guide#guide-player`). */
export function sectionAnchor(id: string): string {
  return `guide-${id.replace(/_/g, '-')}`;
}

/** Plain text of a section, for the search filter. */
export function sectionSearchText(copy: GuideSectionCopy, extra: readonly string[] = []): string {
  return [copy.title, copy.intro, ...Object.values(copy.steps), ...Object.values(copy.tips), ...extra].join(' ');
}

/** Shape every `guide.sections.<id>` entry has in each locale. */
export interface GuideSectionCopy {
  readonly title: string;
  readonly intro: string;
  readonly steps: Readonly<Record<string, string>>;
  readonly tips: Readonly<Record<string, string>>;
}
