// SVG icons as HTML strings — for use in innerHTML / template literals.
// React contexts should use components from components/local/ui/icons.tsx instead.

// ── Inner SVG content (no <svg> wrapper) ─────────────────────────────────────

const INNER: Record<string, string> = {
  game:      `<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4m-2-2v4"/><circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/>`,
  // Rounded screen + play triangle, reading as "animated video" rather than
  // the kanji glyph (which most users couldn't parse as "anime" on sight) —
  // distinct from movie's film-strip grid and series' TV+antenna outline.
  anime:     `<rect x="2.5" y="4" width="19" height="16" rx="3"/><path d="M10 8.5l6 3.5-6 3.5z" fill="currentColor" stroke="none"/>`,
  // Two swept, overlapping pages (an open manga volume) — distinct from the
  // plain rectangular "book" shape below, so manga/light novel/book no
  // longer all render as the exact same icon.
  manga:     `<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>`,
  // Bookmark shape — a light novel reads as prose (a "marked" single volume)
  // rather than an open illustrated book.
  lnovel:    `<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>`,
  // Dialogue bubble — a visual novel is defined by its branching text/dialogue,
  // not by controller input, so it no longer shares the "game" glyph.
  vnovel:    `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  series:    `<rect x="2" y="7" width="20" height="15" rx="2"/><path d="M17 2l-5 5-5-5"/>`,
  movie:     `<rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M17 7h5M2 17h5M17 17h5"/>`,
  book:      `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
  comic:     `<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 9v12"/>`,
  character: `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,

  // Status icons (overview cards variant — flat/minimal)
  planning:    `<path d="M5 2h14M5 22h14M19 2v4a7 7 0 0 1-14 0V2M5 22v-4a7 7 0 0 1 14 0v4"/>`,
  in_progress: `<polygon points="5 3 19 12 5 21 5 3"/>`,
  completed:   `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
  paused:      `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`,
  dropped:     `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,

  star:        `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
  calendar:    `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
  clock:       `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  stack:       `<path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>`,
  package:     `<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>`,
  chart:       `<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>`,
  crown:       `<path d="M2 19.5 4.5 8 9 13l3-7 3 7 4.5-5L22 19.5H2zm0 2h20v1.5H2v-1.5z"/>`,
  person:      `<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>`,

  // Settings page
  settings_appearance:   `<circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>`,
  settings_connections:  `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  settings_environment:  `<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M7 8l2 2-2 2M11 12h4"/>`,
  settings_novedades:    `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>`,
  settings_preferences:  `<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>`,
  reset_arrow:           `<path d="M3 2v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/>`,
  trash:                 `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>`,
  settings_admin:        `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  upload_image:          `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`,
  chevron_left:          `<polyline points="15 18 9 12 15 6"/>`,
  chevron_right:         `<polyline points="9 18 15 12 9 6"/>`,
  rating_faces:          `<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>`,
  github:                `<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>`,
  help_circle:           `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>`,
  import_download:       `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  folder:                `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>`,
  x:                     `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,

  // Profile page
  profile_stats:   `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
  profile_reviews: `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>`,
  profile_lists:   `<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>`,
};

// ── Factory helpers ───────────────────────────────────────────────────────────

function stroke(size: number, width: string, inner: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

function fill(size: number, inner: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">${inner}</svg>`;
}

// ── Media type icons ──────────────────────────────────────────────────────────

const MEDIA_TYPES = ['game', 'anime', 'manga', 'lnovel', 'vnovel', 'series', 'movie', 'book', 'comic'] as const;

function getBaseMediaType(type: string): string {
  // Extract base type from formats like "anime_tv", "manga_ongoing", etc.
  return type.split('_')[0] || 'book';
}

export function typeIconMap(size: number): Record<string, string> {
  const baseTypes = Object.fromEntries(MEDIA_TYPES.map(t => [t, stroke(size, '2', INNER[t])]));
  return new Proxy(baseTypes, {
    get(target, prop) {
      if (typeof prop !== 'string') return undefined;
      const baseType = getBaseMediaType(prop);
      return target[baseType as keyof typeof target] || stroke(size, '2', INNER.book);
    }
  });
}

// ── Status icons ──────────────────────────────────────────────────────────────

export const STATUS_ICONS_14 = {
  completed:   stroke(14, '2.5', INNER.completed),
  in_progress: stroke(14, '2.5', INNER.in_progress),
  planning:    stroke(14, '2.5', INNER.planning),
  paused:      stroke(14, '2.5', INNER.paused),
  dropped:     stroke(14, '2.5', INNER.dropped),
};

// ── Sort icons ────────────────────────────────────────────────────────────────

export const SORT_ICON_SCORE    = stroke(14, '2', INNER.star);
export const SORT_ICON_DATE     = stroke(14, '2', INNER.calendar);
export const SORT_ICON_DURATION = stroke(14, '2', INNER.clock);
export const CALENDAR_ICON      = stroke(14, '2', INNER.calendar);
export const GROUP_EDITIONS_ICON = stroke(14, '2', INNER.stack);
export const GROUP_BUNDLE_ICON   = stroke(14, '2', INNER.package);

// ── Stats / profile icons ─────────────────────────────────────────────────────

export const ICON_STACK  = stroke(18, '2', INNER.stack);
export const ICON_CLOCK  = stroke(18, '2', INNER.clock);
export const ICON_STAR   = stroke(18, '2', INNER.star);
export const ICON_CHART  = stroke(18, '2', INNER.chart);

// Monthly history's "obras" / "personaje" view toggle
export const ICON_MH_MEDIA     = stroke(14, '2', INNER.stack);
export const ICON_MH_CHARACTER = stroke(14, '2', INNER.character);

// ── HOF icons ─────────────────────────────────────────────────────────────────

export const ICON_CROWN  = fill(16, INNER.crown);
export const ICON_PERSON = stroke(16, '2', INNER.person);

// ── Settings page icons ────────────────────────────────────────────────────

export const ICON_SETTINGS_APPEARANCE  = stroke(14, '2', INNER.settings_appearance);
export const ICON_SETTINGS_CONNECTIONS = stroke(14, '2', INNER.settings_connections);
export const ICON_SETTINGS_ENVIRONMENT = stroke(14, '2', INNER.settings_environment);
export const ICON_SETTINGS_NOVEDADES   = stroke(14, '2', INNER.settings_novedades);
export const ICON_SETTINGS_PREFERENCES = stroke(14, '2', INNER.settings_preferences);
export const ICON_RESET_ARROW          = stroke(14, '2', INNER.reset_arrow);
export const ICON_TRASH                = stroke(14, '2', INNER.trash);
export const ICON_SETTINGS_ADMIN       = stroke(14, '2', INNER.settings_admin);
export const ICON_UPLOAD_IMAGE         = stroke(24, '1.5', INNER.upload_image);
export const ICON_CHEVRON_LEFT         = stroke(16, '2.5', INNER.chevron_left);
export const ICON_CHEVRON_RIGHT        = stroke(16, '2.5', INNER.chevron_right);
export const ICON_RATING_FACES         = stroke(18, '2', INNER.rating_faces);
export const ICON_GITHUB               = stroke(18, '2', INNER.github);
export const ICON_HELP_CIRCLE          = stroke(16, '2', INNER.help_circle);
export const ICON_IMPORT_DOWNLOAD      = stroke(14, '2', INNER.import_download);
export const ICON_FOLDER               = stroke(14, '1.75', INNER.folder);
export const ICON_X_SMALL              = stroke(12, '2.5', INNER.x);

// ── Profile page tab icons ──────────────────────────────────────────────────

export const ICON_PROFILE_OVERVIEW  = stroke(20, '2', INNER.person);
export const ICON_PROFILE_LIBRARY   = stroke(20, '2', INNER.book);
export const ICON_PROFILE_FAVORITES = stroke(20, '2.5', INNER.star);
export const ICON_PROFILE_STATS     = stroke(20, '2', INNER.profile_stats);
export const ICON_PROFILE_REVIEWS   = stroke(20, '2', INNER.profile_reviews);
export const ICON_PROFILE_LISTS     = stroke(20, '2', INNER.profile_lists);
