export const TYPE_LABELS: Record<string, string> = {
  anime: 'Anime', manga: 'Manga', novel: 'Novel', game: 'Juego',
  vnovel: 'VN', movie: 'Película', series: 'Serie', book: 'Libro',
};

export const STATUS_LABELS: Record<string, string> = {
  planning: 'Pendiente', watching: 'Viendo', reading: 'Leyendo',
  playing: 'Jugando', completed: 'Completado', paused: 'Pausado', dropped: 'Abandonado',
};

export const typeLabel   = (t: string) => TYPE_LABELS[t]   ?? t;
export const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

export function pad(n: number): string {
  if (n < 10)  return '00' + n;
  if (n < 100) return '0'  + n;
  return String(n);
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const [, p] = token.split('.');
    return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return {}; }
}
