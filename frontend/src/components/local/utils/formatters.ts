import { formatUnixTimestampShort, formatDateLong } from '../../../lib/shared/formatDate';
export { catalogReleaseTimestampMs, firstCsvUrl } from '../../../lib/media/mapper-utils';

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
  return formatUnixTimestampShort(ts) ?? '—';
}

export function formatDate(timestamp?: number): string | null {
  if (!timestamp) return null;
  try {
    return formatDateLong(new Date(timestamp * 1000));
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

// A playback position in seconds -> "M:SS", or "H:MM:SS" past the first
// hour — movies (LocalMediaDetailPanel's own resume-position label) can
// run well past 60 minutes, unlike NowPlayingBar's own progress bar, which
// used to format the same kind of value without ever accounting for that.
export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
