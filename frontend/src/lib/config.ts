// PUBLIC_ prefix required for Astro to expose env vars to the client
export const API_URL         = import.meta.env.PUBLIC_API_URL         ?? 'http://localhost:8787';
// Añadir PUBLIC_TMDB_TOKEN en frontend/.env.local
export const TMDB_READ_TOKEN = import.meta.env.PUBLIC_TMDB_TOKEN      ?? '';
