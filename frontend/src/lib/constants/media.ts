// ─── Media type groupings ─────────────────────────────────────────────────────

export const ANILIST_TYPES = ['anime', 'manga', 'lnovel'] as const;
type AniListMediaType = typeof ANILIST_TYPES[number];

export const IGDB_TYPES = ['game', 'vnovel'] as const;

export const ALL_MEDIA_TYPES = [
  'anime', 'manga', 'lnovel', 'game', 'vnovel', 'series', 'movie', 'book', 'comic', 'character',
] as const;

// Search tab order (includes 'all' sentinel)
export const SEARCH_TAB_TYPES = [
  'all', 'anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series', 'book', 'comic', 'character', 'staff',
] as const;

// Types that have a dedicated detail page. 'staff' isn't in ALL_MEDIA_TYPES
// (it can't be favorited/added to a library like a character can) but does
// have one — it resolves to the existing /author page (person:a<id>, same
// as an AniList staff link from quick search), not a new /staff page.
export const DETAIL_SUPPORTED_TYPES = [
  'anime', 'manga', 'lnovel', 'book', 'comic', 'game', 'vnovel', 'movie', 'series', 'character', 'staff',
] as const;

// ─── Labels ───────────────────────────────────────────────────────────────────

import { getT } from '../../i18n/client';

export function getTypeLabel(type: string): string {
  const t = getT();
  const searchTypeMap: Record<string, string | undefined> = {
    anime: t.search?.types?.anime,
    manga: t.search?.types?.manga,
    lnovel: t.search?.types?.lnovel,
    game: t.search?.types?.game,
    vnovel: t.search?.types?.vnovel,
    series: t.search?.types?.series,
    movie: t.search?.types?.movie,
    book: t.search?.types?.book,
    comic: t.search?.types?.comic,
    character: t.search?.types?.character,
    staff: t.search?.types?.staff,
  };
  return searchTypeMap[type] || type;
}

export function getGenreLabel(genre: string): string {
  const t = getT();
  const genres = (t as any).genres as Record<string, string> | undefined;
  return genres?.[genre] || genre;
}

// ─── AniList formats ──────────────────────────────────────────────────────────

const ANIME_FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'] as const;
const MANGA_FORMATS = ['MANGA', 'NOVEL', 'ONE_SHOT'] as const;

export const ANIME_FORMAT_SET = new Set<string>(ANIME_FORMATS);
export const MANGA_FORMAT_SET = new Set<string>(MANGA_FORMATS);

// ─── AniList status maps ──────────────────────────────────────────────────────

// App status → AniList mutation value
export const APP_TO_ANILIST_STATUS: Record<string, string | null> = {
  planning:  'PLANNING',
  watching:  'CURRENT',
  reading:   'CURRENT',
  completed: 'COMPLETED',
  paused:    'PAUSED',
  dropped:   'DROPPED',
  '':        null,
};

// AniList list status → app status
export const ANILIST_TO_APP_STATUS: Record<string, string> = {
  CURRENT:   'watching',
  PLANNING:  'planning',
  COMPLETED: 'completed',
  PAUSED:    'paused',
  DROPPED:   'dropped',
};

// ─── Library status groupings ────────────────────────────────────────────────

// "In progress" spans three verbs depending on media type (watching an anime,
// reading a manga, playing a game) — every place that buckets library entries
// by progress state used to repeat this 3-way check inline.
export const IN_PROGRESS_STATUSES = ['watching', 'reading', 'playing'] as const;

export function isInProgressStatus(status: string | null | undefined): boolean {
  return status != null && (IN_PROGRESS_STATUSES as readonly string[]).includes(status);
}

// "Read" (chapters/pages) vs. "watch" (episodes) — the same split was
// independently re-declared as its own Set in LocalMediaCard.tsx and
// NowPlayingBar.tsx, and re-derived as an inverse condition in
// LocalMediaDetailPanel.tsx and playback-service.ts. One place to add a
// 7th media type to the reading side later, instead of four.
export const READING_TYPES = new Set(['manga', 'lnovel', 'book']);

export function isReadingType(type: string | null | undefined): boolean {
  return type != null && READING_TYPES.has(type);
}

// A season/update/issue/episode-tagged catalog entry (a Steam "season pass"
// or similar bundle child) isn't a separately-countable/launchable work of
// its own — it shows as itself but rolls up into whatever it's part of.
// Independently declared with the identical value in Local's
// catalogGameLinking.ts and Profile's stats-calculators.ts before being
// pulled out here.
export const SUB_WORK_FORMATS = new Set(['SEASON', 'UPDATE', 'ISSUE', 'EPISODE']);
