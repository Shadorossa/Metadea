// PUBLIC_ prefix required for Astro to expose env vars to the client
export const API_URL = import.meta.env.PUBLIC_API_URL ?? 'http://localhost:8787';
