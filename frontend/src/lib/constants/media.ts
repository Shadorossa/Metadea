// ─── Media type groupings ─────────────────────────────────────────────────────

export const ANILIST_TYPES = ['anime', 'manga', 'lnovel'] as const;
export type AniListMediaType = typeof ANILIST_TYPES[number];

export const IGDB_TYPES = ['game', 'vnovel'] as const;
export type IgdbMediaType = typeof IGDB_TYPES[number];

export const ALL_MEDIA_TYPES = [
  'anime', 'manga', 'lnovel', 'game', 'vnovel', 'series', 'movie', 'book', 'comic', 'character',
] as const;
export type CoreMediaType = typeof ALL_MEDIA_TYPES[number];

// Search tab order (includes 'all' sentinel)
export const SEARCH_TAB_TYPES = [
  'all', 'anime', 'manga', 'lnovel', 'game', 'vnovel', 'movie', 'series', 'book', 'comic', 'character',
] as const;

// Types that have a dedicated detail page
export const DETAIL_SUPPORTED_TYPES = [
  'anime', 'manga', 'lnovel', 'book', 'comic', 'game', 'vnovel', 'movie', 'series', 'character',
] as const;

// ─── Labels ───────────────────────────────────────────────────────────────────

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

// media_catalog.format values for games (see GAME_TYPE_FORMAT in igdb-mapper.ts)
export const GAME_FORMAT_LABELS: Record<string, string> = {
  GAME:          'Juego base',
  REMAKE:        'Remake',
  REMASTER:      'Remaster',
  EXPANDED_GAME: 'Edición extendida',
  PORT:          'Port',
  FORK:          'Fork',
  EXPANSION:     'Expansión',
  MOD:           'Mod',
  EPISODE:       'Episodio',
  SEASON:        'Temporada',
  UPDATE:        'Actualización',
};

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

// ─── Gradients ────────────────────────────────────────────────────────────────

export const TYPE_GRADIENTS: Record<string, string> = {
  anime:  'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
  manga:  'linear-gradient(135deg, #ec4899 0%, #be185d 100%)',
  lnovel: 'linear-gradient(135deg, #10b981 0%, #047857 100%)',
  game:   'linear-gradient(135deg, #f59e0b 0%, #b45309 100%)',
  vnovel: 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)',
  series: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)',
  movie:  'linear-gradient(135deg, #6366f1 0%, #4338ca 100%)',
  book:   'linear-gradient(135deg, #6b7280 0%, #374151 100%)',
  comic:  'linear-gradient(135deg, #f97316 0%, #c2410c 100%)',
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
