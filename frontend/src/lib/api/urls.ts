// PUBLIC_ prefix required for Astro to expose env vars to the client
export const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:8787';
// Shared character/media images use the same Worker as the app's online services.
export const SHARED_IMAGE_WORKER_URL = API_URL.replace(/\/+$/, '');
