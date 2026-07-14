export function formatPlaytime(minutes?: number): string {
  if (!minutes || minutes === 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatLastPlayed(ts?: number): string {
  if (!ts || ts === 0) return '—';
  return new Date(ts * 1000).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDate(timestamp?: number): string | null {
  if (!timestamp) return null;
  try {
    return new Date(timestamp * 1000).toLocaleDateString('es-ES', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch { return null; }
}

// SQLite's CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" (UTC, no offset) —
// the space instead of "T" makes most JS engines parse it as local time
// instead of UTC, so normalize it first.
export function formatWatchedAt(sqliteTimestamp: string): string {
  const d = new Date(sqliteTimestamp.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return sqliteTimestamp;
  return d.toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
