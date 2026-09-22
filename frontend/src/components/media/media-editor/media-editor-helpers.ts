// Pure, state-free helpers behind MediaEditorModal's header fields, tab
// labels and date inputs.
import type { Translations } from '../../../i18n/index';

// Progress field(s) shown in the header — which label(s) and step apply
// depend on the media type. progLabel matches the raw type (not its
// underscore-stripped base) to preserve each edge case's original mapping.
export function getProgressConfig(type: string, format: string | undefined, tm: Translations['media']): { label: string | null; label2: string | null; step: number } {
  const base = type.split('_')[0];

  let label: string | null;
  if (type === 'game' || type === 'vnovel')            label = tm.progress_hours;
  else if (type === 'anime' || type === 'series')      label = tm.progress_episodes;
  else if (type === 'manga' || type === 'lnovel')      label = tm.progress_chapters;
  // 'book' (singular) — 'books' here never matched anything real, so a
  // book's progress fell through to the generic label below and its
  // total (page count) was never wired up at all.
  else if (type === 'book')                            label = tm.progress_pages;
  else if (type === 'event')                           label = tm.stat_matches;
  else                                                 label = tm.editor.progress;

  // A movie is a single sitting, not a run of seasons — even though it's
  // still type 'anime'/'series' (format is what actually distinguishes it).
  const isMovie = format === 'MOVIE';
  const label2 =
    isMovie ? null :
    base === 'anime' || base === 'series'      ? tm.progress_seasons :
    base === 'event'                           ? tm.progress_seasons :
    base === 'manga' || base === 'lnovel'      ? tm.progress_volumes : null;

  const step = base === 'game' || base === 'vnovel' ? 0.5 : 1;
  return { label, label2, step };
}

// No work catalogued here predates this — anything a user types earlier
// (typo, wrong era) gets pulled up to it rather than silently accepted.
export const MIN_DATE_YEAR = 1950;

export function clampDateMinYear(value: string): string {
  if (!value) return value;
  const [year, month, day] = value.split('-');
  return Number(year) < MIN_DATE_YEAR ? `${MIN_DATE_YEAR}-${month}-${day}` : value;
}

// ISO YYYY-MM-DD strings compare correctly lexicographically.
export function clampNotBefore(value: string, floor: string): string {
  return value && floor && value < floor ? floor : value;
}

// Relation cards link to another media page via "/media?id=<externalId>" —
// pull that id back out to look up/link the related game's own log.
export function extractExternalIdFromRelationUrl(url: string | null | undefined): string | undefined {
  const match = url?.match(/id=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

// Log tab labels show only what's after the title's colon (e.g. "Trails in
// the Sky: 2nd Chapter" → "2nd Chapter") — titles rarely share a common
// prefix with the base game, so diffing against it wasn't reliable. A
// remainder of 2 characters or less ("II", "S2", ":D"...) reads as noise
// rather than a real edition name, so the full title is kept instead.
export function editionTabLabel(editionTitle: string, defaultLabel: string = 'Edition'): string {
  if (!editionTitle) return defaultLabel;
  const idx = editionTitle.indexOf(':');
  if (idx === -1) return editionTitle;
  const after = editionTitle.slice(idx + 1).trim();
  return after.length > 2 ? after : editionTitle;
}

// Same 2-character noise floor as editionTabLabel above — a colon or
// baseTitle-prefix remainder of "II"/"S2"/etc. isn't a usable label on its
// own, so the full title is kept instead of a near-blank tab.
export function formatSeasonTabLabel(title: string, baseTitle?: string): string {
  if (!title) return '';
  const colonIdx = title.indexOf(':');
  if (colonIdx !== -1) {
    const after = title.slice(colonIdx + 1).trim();
    if (after.length > 2) return after;
  }
  if (baseTitle && baseTitle.trim().length > 2) {
    const normBase = baseTitle.trim().toLowerCase();
    const normTitle = title.trim().toLowerCase();
    if (normTitle.startsWith(normBase)) {
      const remainder = title.trim().slice(baseTitle.trim().length).replace(/^[\s:\-–—]+/, '').trim();
      if (remainder.length > 2) return remainder;
    }
  }
  return title;
}

// Playtime (game/vnovel progress) is stored as decimal hours (0.5 = 30min,
// same as before this existed) — only how it's typed/displayed changes.
// "H:MM" reads far more naturally for hours+minutes than a raw decimal, and
// a native <input type="number"> can't be typed with ":" at all (nor with
// "," as a decimal separator — Chromium's number input only accepts "."
// regardless of OS locale, so a Spanish-locale "10,3" silently failed to
// parse as anything).
export function formatHoursColon(decimalHours: number): string {
  // Empty, not "0:00" — matches NumberField's own value={value || ''}: an
  // unlogged/zero entry starts blank (with "0:00" as a greyed-out
  // placeholder hint) so typing "6" or "6:45" works immediately instead of
  // first having to clear out baked-in text.
  if (!decimalHours) return '';
  let h = Math.floor(decimalHours);
  let m = Math.round((decimalHours - h) * 60);
  if (m === 60) { m = 0; h += 1; }
  return `${h}:${String(m).padStart(2, '0')}`;
}

// null = invalid (wrong shape, or minutes >= 60 — "H:90" is never accepted,
// not even clamped) — the caller reverts to the last valid display instead.
export function parseHoursColonInput(raw: string): number | null {
  const match = raw.trim().match(/^(\d+)(?::(\d{1,2}))?$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  if (m > 59) return null;
  return h + m / 60;
}

export function isFutureDate(year: number | null | undefined, month: number | null | undefined, day: number | null | undefined): boolean {
  if (!year) return false;
  const releaseDate = new Date(year, (month ?? 1) - 1, day ?? 1);
  return releaseDate.getTime() > Date.now();
}
