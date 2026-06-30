export type PlatformId = 'steam' | 'epic' | 'gog' | 'xbox' | 'ea' | 'nintendo' | 'playstation' | 'local';
export type CategoryId = 'videojuegos' | 'visual-novel' | 'anime' | 'manga' | 'light-novel' | 'books' | 'series' | 'movies';

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
  { id: 'series',       label: 'Series' },
  { id: 'movies',       label: 'Películas' },
];

export const LAUNCHER_ORDER: PlatformId[] = ['steam', 'epic', 'gog', 'xbox', 'ea', 'nintendo', 'playstation'];

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

export const STEAM_COVER = (appId: string) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`;
