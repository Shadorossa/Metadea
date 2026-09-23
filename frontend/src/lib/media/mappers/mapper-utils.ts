import { getLangCode } from '../../../i18n/runtime';

export interface DateParts {
  year: number | null | undefined;
  month?: number | null;
  day?: number | null;
}

/** Convert a Unix timestamp (seconds) to a { year, month, day } triple (UTC). */
export function unixToDateParts(unixSeconds: number): DateParts {
  const d = new Date(unixSeconds * 1000);
  // All three fields must come from the same clock — year used to be read
  // via getFullYear() (local time) while month/day used getUTCMonth()/
  // getUTCDate(), so for any timezone other than UTC+0, a release date near
  // a year boundary (e.g. Dec 31 UTC) could pair the wrong year with the
  // right month/day, or vice versa.
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

// Provider dates come in different shapes: ComicVine's cover_date is a
// consistent "YYYY-MM-DD", Open Library's first_publish_date is free text —
// most often a bare year ("1954"), sometimes ISO-ish ("1954-07-29"/
// "1954-07"), occasionally long-form ("July 29, 1954"). The ISO-ish branch
// already covers ComicVine's exact format, so one parser serves both
// mappers instead of two independently-written near-duplicates. Tried in
// order below; falls back to the JS Date parser (which understands the
// long-form case) before giving up entirely.
export function parseFlexibleDate(raw: string | null | undefined): DateParts | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}$/.test(trimmed)) {
    return { year: parseInt(trimmed, 10) };
  }
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoMatch) {
    return {
      year:  parseInt(isoMatch[1], 10),
      month: parseInt(isoMatch[2], 10),
      day:   isoMatch[3] ? parseInt(isoMatch[3], 10) : undefined,
    };
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
  }
  return null;
}

/** Format a date triple using the active UI locale. */
export function formatDateParts(
  d: DateParts | null | undefined,
  opts: { monthStyle?: 'short' | 'long'; requireDay?: boolean } = {},
): string {
  if (!d?.year) return '';
  if (!d.month) return String(d.year);
  const { monthStyle = 'long', requireDay = false } = opts;
  const date = new Date(d.year, d.month - 1, d.day ?? 1);
  return date.toLocaleDateString(getLangCode(), {
    year: 'numeric',
    month: monthStyle,
    day: (requireDay || d.day) ? 'numeric' : undefined,
  });
}

/** Normalize a 0-100 score to a 0-10 scale, rounded to 1 decimal. Falsy input (0/undefined) yields undefined. */
export function normalizeScore100(raw: number | undefined | null): number | undefined {
  if (!raw) return undefined;
  return Math.round((raw / 10) * 10) / 10;
}

// Look up a translated label by an API key in an i18n dictionary
export function lookupLabel(dict: Record<string, string>, key: string | null | undefined, fallback: string): string {
  return (key ? dict[key] : undefined) ?? fallback;
}

/** Turn an ISO 3166-1 country code (e.g. "JP") into its localized display
 *  name via the platform's own Intl data, instead of maintaining our own
 *  code→name map. Falls back to the raw code if Intl can't resolve it. */
export function countryName(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  try {
    return new Intl.DisplayNames([getLangCode()], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Pick the entry matching a preferred country code (default "US"), or the
 *  first entry if no match — used for TMDB's per-country age ratings, which
 *  have no single global value. */
export function pickPreferredCountry<T extends { iso_3166_1: string }>(
  entries: T[] | undefined,
  preferred = 'US',
): T | undefined {
  if (!entries?.length) return undefined;
  return entries.find(e => e.iso_3166_1 === preferred) ?? entries[0];
}

/** Collapses same-family platform entries that only differ by a trailing
 *  generation number — ["PlayStation 4", "PlayStation 5"] becomes
 *  "PlayStation 4/5", ["PlayStation 2", "PlayStation 4", "PlayStation 5"]
 *  becomes "PlayStation 2/4/5" — instead of listing each generation as its
 *  own separate line. Platforms without a trailing number (e.g. "PC
 *  (Windows)", "Nintendo Switch") pass through unchanged. Order follows
 *  each group's first appearance in the input. */
export function mergePlatformVersions(platforms: string[]): string[] {
  const order: string[] = [];
  const numbersByBase = new Map<string, string[]>();
  const passthrough: string[] = [];

  for (const p of platforms) {
    const match = p.match(/^(.*\S)\s+(\d+)$/);
    if (!match) {
      passthrough.push(p);
      continue;
    }
    const [, base, num] = match;
    if (!numbersByBase.has(base)) {
      numbersByBase.set(base, []);
      order.push(base);
    }
    const nums = numbersByBase.get(base)!;
    if (!nums.includes(num)) nums.push(num);
  }

  const merged = order.map(base => `${base} ${numbersByBase.get(base)!.sort((a, b) => Number(a) - Number(b)).join('/')}`);
  return [...merged, ...passthrough];
}

// Parse external_id (e.g. "anime:123") into type and numeric ID
export function parseExternalId(externalId: string): { type: string; id: number } {
  const colonIdx = externalId.indexOf(':');
  const type = externalId.slice(0, colonIdx).split('_')[0];
  const id = parseInt(externalId.slice(colonIdx + 1), 10);
  return { type, id };
}

// Game and visual novel share one numeric IGDB id space, filed under
// whichever prefix `isVn` resolves to (see detect_vn/is_vn in igdb.rs, and
// media_catalog.rs's OR'd vnovel:/game: lookups on the Rust side) — every
// frontend site that built or read this specific prefix pair used to spell
// 'vnovel:'/'game:' out by hand independently; these two are the one shared
// version now.
export function gameExternalId(igdbId: number | string, isVn: boolean): string {
  return `${isVn ? 'vnovel' : 'game'}:${igdbId}`;
}

export function isVnovelExternalId(externalId: string): boolean {
  return externalId.startsWith('vnovel:');
}

// A TMDB series has no per-season catalog row the way an AniList anime does
// (one media_catalog row covers the whole show) — so MediaEditorModal's
// "Unificar temporadas" season tabs for series key their own status/rating/
// progress under this synthetic id instead, purely so it can be saved and
// reloaded through the normal library_entries table. It never has a
// matching media_catalog row and must never be treated as a real media page
// or surfaced anywhere that lists "your library" as if it were a real work
// (see isSeriesSeasonSyntheticId's callers — getAllLibraryEntries filters it
// out at the source).
export function seriesSeasonExternalId(seriesExternalId: string, seasonNumber: number): string {
  return `${seriesExternalId}:season:${seasonNumber}`;
}

export function isSeriesSeasonSyntheticId(externalId: string): boolean {
  return /:season:\d+$/.test(externalId);
}


// Release date -> milliseconds since epoch, or null when there's no
// release_year on file at all. Was independently reimplemented in Local
// (three places) and Profile's LibrarySection before being pulled out here
// as the one shared version.
export function catalogReleaseTimestampMs(
  entry?: { release_year?: number | null; release_month?: number | null; release_day?: number | null } | null,
): number | null {
  if (!entry?.release_year) return null;
  return new Date(entry.release_year, (entry.release_month ?? 1) - 1, entry.release_day ?? 1).getTime();
}

// First URL out of a comma-separated column (banners_csv) — trims each
// entry, unlike a plain .split(',')[0], so a CSV saved with a space after
// the comma doesn't silently fail to load. Was independently reimplemented
// (one trimming, one not) across Local's detail panels and lib/media's own
// catalog/mediaService mappers before being pulled out here.
export function firstCsvUrl(csv?: string | null): string | null {
  return csv?.split(',')[0]?.trim() || null;
}

// Create a sort key [year, month, day] for comparisons (unknowns sorted last)
export function getReleaseDateKey(item: { release_year?: number | null; release_month?: number | null; release_day?: number | null }): [number, number, number] {
  return [
    item.release_year ?? Infinity,
    item.release_month ?? Infinity,
    item.release_day ?? Infinity,
  ];
}

/** Compare two items by their release dates (year, month, day, then by ID as tiebreaker). */
export function compareByReleaseDate<T extends { release_year?: number | null; release_month?: number | null; release_day?: number | null; id?: string }>(a: T, b: T): number {
  const keyA = getReleaseDateKey(a);
  const keyB = getReleaseDateKey(b);
  if (keyA[0] !== keyB[0]) return keyA[0] - keyB[0];
  if (keyA[1] !== keyB[1]) return keyA[1] - keyB[1];
  if (keyA[2] !== keyB[2]) return keyA[2] - keyB[2];
  return (a.id || '').localeCompare(b.id || '');
}

/** Newest-first version of compareByReleaseDate — unlike a plain sign flip,
 *  entries with no known date still sort last instead of jumping to the
 *  front (getReleaseDateKey's Infinity-for-unknown convention only reads as
 *  "last" for ascending order). Used for "recent appearances" style lists. */
export function compareByReleaseDateDesc<T extends { release_year?: number | null; release_month?: number | null; release_day?: number | null; id?: string }>(a: T, b: T): number {
  const keyA = getReleaseDateKey(a);
  const keyB = getReleaseDateKey(b);
  const aUnknown = keyA[0] === Infinity;
  const bUnknown = keyB[0] === Infinity;
  if (aUnknown !== bUnknown) return aUnknown ? 1 : -1;
  if (keyA[0] !== keyB[0]) return keyB[0] - keyA[0];
  if (keyA[1] !== keyB[1]) return keyB[1] - keyA[1];
  if (keyA[2] !== keyB[2]) return keyB[2] - keyA[2];
  return (a.id || '').localeCompare(b.id || '');
}

/** compareByReleaseDate, with title as the tiebreaker instead of ID — used
 *  for appearance lists where entries are keyed by title, not a stable ID. */
export function compareByReleaseDateThenTitle<T extends { release_year?: number | null; release_month?: number | null; release_day?: number | null; title: string }>(a: T, b: T): number {
  return compareByReleaseDate(a, b) || a.title.localeCompare(b.title);
}

/** Map AniList type/format to internal media types ('anime', 'lnovel', 'manga'). */
export function mapExternalFormatToType(type: string | null | undefined, format: string | null | undefined): 'anime' | 'lnovel' | 'manga' {
  const lowerType = type?.toLowerCase();
  if (lowerType === 'anime') return 'anime';
  if (format === 'NOVEL') return 'lnovel';
  return 'manga';
}

// Trailing "1st Season" / "Season 2" / "The Final Season" / "... Part 2"
// wording, with whatever separator precedes it (": ", " - ", or just a
// space). AniList titles each season as its own fully independent entry
// (see anilist-mapper.ts), so this text is the ONLY thing that actually says
// "this is season N" on a season's own title — useful on its own, but
// redundant once "Unificar temporadas" (preferences.ts) already shows a "T2"
// badge right next to it (MediaPage.tsx's Temporadas tab, LibraryCard.tsx's
// fused card). Purely a display tweak: never touches title_main itself, so
// nothing saved/synced ever sees a stripped title.
const SEASON_SUFFIX_RE = /[\s:\-–—]+(the\s+)?(final\s+season(\s*[-–—:]?\s*part\s*\d+)?|\d+(st|nd|rd|th)\s+season|season\s+\d+|part\s+\d+)\s*$/i;

export function stripSeasonSuffix(title: string): string {
  const stripped = title.replace(SEASON_SUFFIX_RE, '').trim();
  return stripped || title; // never collapse to an empty string
}

// AniList tags most recap movies with this exact wording in their own
// synopsis ("(Recompilation film)"/"Movie compilation") — these aren't a
// real chain entry (an edited-together clip-show of episodes that already
// aired, not new content), so mediaService.ts auto-blocks them the moment
// they're first fetched (see persistToCatalog's blocked_at), keeping them out
// of Temporadas/saga chains without a curator needing to notice and block
// each one by hand via PrEditorModal.
const RECOMPILATION_FILM_RE = /recompilation film|movie compilation/i;

export function isRecompilationFilm(description: string | null | undefined): boolean {
  return !!description && RECOMPILATION_FILM_RE.test(description);
}

