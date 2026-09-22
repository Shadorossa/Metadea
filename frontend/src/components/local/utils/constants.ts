import { API_ENDPOINTS } from '../../../lib/api/endpoints';

export type PlatformId = 'steam' | 'epic' | 'gog' | 'xbox' | 'ea' | 'nintendo' | 'playstation' | 'local';
export type CategoryId = 'videojuegos' | 'visual-novel' | 'anime' | 'manga' | 'light-novel' | 'books' | 'comics' | 'series' | 'movies';

export const LOCAL_CATEGORY_BY_MEDIA_TYPE: Record<string, CategoryId> = {
  anime: 'anime', manga: 'manga', lnovel: 'light-novel', book: 'books', comic: 'comics',
  series: 'series', movie: 'movies', game: 'videojuegos', vnovel: 'visual-novel',
};

export const PLATFORM_LABEL: Record<PlatformId, string> = {
  steam:       'Steam',
  epic:        'Epic Games',
  gog:         'GOG',
  xbox:        'Xbox',
  ea:          'EA',
  nintendo:    'Nintendo',
  playstation: 'PlayStation',
  local:       'Local',
};

export const CATEGORIES: Array<{ id: CategoryId; label: string }> = [
  { id: 'videojuegos',  label: 'Videojuegos' },
  { id: 'visual-novel', label: 'Novela visual' },
  { id: 'anime',        label: 'Anime' },
  { id: 'manga',        label: 'Manga' },
  { id: 'light-novel',  label: 'Novela Ligera' },
  { id: 'books',        label: 'Libros' },
  { id: 'comics',       label: 'Comics' },
  { id: 'series',       label: 'Series' },
  { id: 'movies',       label: 'Películas' },
];

export const LAUNCHER_ORDER: PlatformId[] = ['steam', 'epic', 'gog', 'xbox', 'ea', 'nintendo', 'playstation', 'local'];

export const PLATFORM_LOGO: Record<PlatformId, string> = {
  steam:       '/platforms/steam_logo.png',
  xbox:        '/platforms/xbox_logo.png',
  epic:        '/platforms/epic_logo.png',
  gog:         '/platforms/gog_logo.png',
  ea:          '/platforms/EA_logo.png',
  nintendo:    '/platforms/nintendo_logo.png',
  playstation: '/platforms/playstation_logo.png',
  local:       '',
};

// Same duration/easing as the detail panel's own slide — each launcher
// title row's rule reflows along with .local-main-content narrowing or
// widening on every panel open/close, so animating it at the SAME pace as
// the panel itself is what reads as one coherent motion instead of two
// unrelated things happening on screen at once.
export const LAUNCHER_LINE_TRANSITION = { duration: 0.3, ease: [0.25, 0, 0.15, 1] as const };
