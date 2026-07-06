/**
 * Centralized API endpoints
 * Single source of truth for all external API URLs
 */

export const API_ENDPOINTS = {
  // AniList GraphQL API
  ANILIST: 'https://graphql.anilist.co',

  // The Movie Database (TMDB)
  TMDB: 'https://api.themoviedb.org/3',
  TMDB_IMAGE: (path: string, size: string = 'w300') => `https://image.tmdb.org/t/p/${size}${path}`,

  // Open Library
  OPENLIBRARY: 'https://openlibrary.org',
  OPENLIBRARY_COVERS: 'https://covers.openlibrary.org/b/id',

  // GitHub API
  GITHUB: 'https://api.github.com',
  GITHUB_DEVICE_LOGIN: 'https://github.com/login/device',

  // Steam covers (dynamic)
  STEAM_COVERS: (appId: string | number) =>
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`,
} as const;

export type ApiEndpoints = typeof API_ENDPOINTS;
