import { formatUnixTimestampShort, formatDateLong } from '../../../lib/shared/formatDate';

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

// Shared release-date math for a MediaCatalogEntry (or any object with the
// same three fields) — was independently reimplemented in three places
// (LocalMediaSection, LocalMediaDetailPanel, GameDetailPanel), one of which
// additionally divides by 1000 for formatDate's unix-seconds input. This
// stays milliseconds (matching Date.now() comparisons, the more common use)
// — a caller feeding formatDate() divides by 1000 itself at the call site,
// same as GameDetailPanel already did, just no longer duplicating the
// underlying new Date(...).getTime() alongside it.
// First URL out of a comma-separated column (banners_csv, genres_csv-shaped
// data) — GameDetailPanel and LocalMediaDetailPanel each read banners_csv's
// first entry independently, one trimming and one not; a CSV saved with a
// space after the comma would silently fail to load only in the one that
// doesn't trim.
export function firstCsvUrl(csv?: string | null): string | null {
  return csv?.split(',')[0]?.trim() || null;
}

export function catalogReleaseTimestampMs(
  entry?: { release_year?: number | null; release_month?: number | null; release_day?: number | null } | null,
): number | null {
  if (!entry?.release_year) return null;
  return new Date(entry.release_year, (entry.release_month ?? 1) - 1, entry.release_day ?? 1).getTime();
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
