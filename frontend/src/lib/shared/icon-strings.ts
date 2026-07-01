// SVG icons as HTML strings — for use in innerHTML / template literals.
// React contexts should use components from components/local/ui/icons.tsx instead.

// ── Inner SVG content (no <svg> wrapper) ─────────────────────────────────────

const INNER: Record<string, string> = {
  game:      `<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4m-2-2v4"/><circle cx="16" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="18" cy="13" r="1" fill="currentColor" stroke="none"/>`,
  anime:     `<path d="M8 4c-1 0-2 1-2 2v2c0 1 .5 2 1 2.5-.5.5-1 1.5-1 2.5 0 2 1 3 2 3h8c1 0 2-1 2-3 0-1-.5-2-1-2.5.5-.5 1-1.5 1-2.5V6c0-1-1-2-2-2H8z"/><circle cx="10" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="10" r="1" fill="currentColor" stroke="none"/>`,
  manga:     `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
  lnovel:    `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
  vnovel:    `<rect x="2" y="6" width="20" height="12" rx="4"/><path d="M6 12h4m-2-2v4"/><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none"/>`,
  series:    `<rect x="2" y="7" width="20" height="15" rx="2"/><path d="M17 2l-5 5-5-5"/>`,
  movie:     `<rect x="2" y="2" width="20" height="20" rx="2"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M17 7h5M2 17h5M17 17h5"/>`,
  book:      `<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>`,
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
  chart:       `<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>`,
  crown:       `<path d="M2 19.5 4.5 8 9 13l3-7 3 7 4.5-5L22 19.5H2zm0 2h20v1.5H2v-1.5z"/>`,
  person:      `<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>`,
};

// ── Factory helpers ───────────────────────────────────────────────────────────

function stroke(size: number, width: string, inner: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

function fill(size: number, inner: string): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">${inner}</svg>`;
}

// ── Media type icons ──────────────────────────────────────────────────────────

const MEDIA_TYPES = ['game', 'anime', 'manga', 'lnovel', 'vnovel', 'series', 'movie', 'book'] as const;

export function getBaseMediaType(type: string): string {
  // Extract base type from formats like "anime_tv", "manga_ongoing", etc.
  return type.split('_')[0] || 'book';
}

export function typeIconStr(type: string, size: number): string {
  const baseType = getBaseMediaType(type);
  const inner = INNER[baseType] ?? INNER.book;
  return stroke(size, '2', inner);
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

export function statusIconStr(status: string, size: number): string {
  const inner = INNER[status] ?? '';
  return stroke(size, '2.5', inner);
}

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

// ── Stats / profile icons ─────────────────────────────────────────────────────

export const ICON_STACK  = stroke(18, '2', INNER.stack);
export const ICON_CLOCK  = stroke(18, '2', INNER.clock);
export const ICON_STAR   = stroke(18, '2', INNER.star);
export const ICON_CHART  = stroke(18, '2', INNER.chart);

// ── HOF icons ─────────────────────────────────────────────────────────────────

export const ICON_CROWN  = fill(16, INNER.crown);
export const ICON_PERSON = stroke(16, '2', INNER.person);
