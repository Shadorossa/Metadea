// ─── Media type groupings ─────────────────────────────────────────────────────

export const ANILIST_TYPES = ['anime', 'manga', 'lnovel'] as const;
type AniListMediaType = typeof ANILIST_TYPES[number];

export const IGDB_TYPES = ['game', 'vnovel'] as const;

export const ALL_MEDIA_TYPES = [
  'anime', 'manga', 'lnovel', 'game', 'vnovel', 'series', 'movie', 'book', 'comic', 'character',
] as const;

// Search tab order (includes 'all' sentinel)
export const SEARCH_TAB_TYPES = [
  'all', 'anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series', 'book', 'comic', 'character',
] as const;

// Types that have a dedicated detail page
export const DETAIL_SUPPORTED_TYPES = [
  'anime', 'manga', 'lnovel', 'book', 'comic', 'game', 'vnovel', 'movie', 'series', 'character',
] as const;

// ─── Labels ───────────────────────────────────────────────────────────────────

import { getT } from '../../i18n/client';

export const TYPE_LABELS: Record<string, string> = {
  anime:  'Anime',
  manga:  'Manga',
  lnovel: 'Light Novel',
  game:   'Game',
  vnovel: 'Visual Novel',
  series: 'Series',
  movie:  'Movie',
  book:   'Book',
  comic:  'Comic',
};

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
  };
  return searchTypeMap[type] || TYPE_LABELS[type] || type;
}

const FAV_LABELS: Record<string, string> = {
  anime_fav:     'Anime',
  manga_fav:     'Manga',
  lnovel_fav:    'Light Novels',
  game_fav:      'Games',
  vnovel_fav:    'Visual Novels',
  series_fav:    'Series',
  movie_fav:     'Movies',
  book_fav:      'Books',
  multimedia_fav:'Multimedia',
  character_fav: 'Characters',
};

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
