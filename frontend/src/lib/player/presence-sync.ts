// Pure decisions behind Discord Rich Presence for video playback: which
// timestamps to show and whether the last presence sent is stale enough to
// re-send. Used by lib/local/playback-service.ts for both engines.

export type PresenceStatus = 'playing' | 'paused';

export interface PresenceLinesInput {
  title: string;
  episodeNumber: number;
  // Screenshot-style label (S01E02, E02, M01); built from the number when absent.
  episodeLabel?: string;
  episodeTitle?: string;
  status: PresenceStatus;
}

// Discord's two lines: `Watching <title>` / `S01E02 - <episode title>` (or
// `E02` when nothing more is known, `M01` for movies), with ` · Paused`
// appended while paused. English literals on purpose: these go to Discord,
// not to the app's own UI.
export function formatPresenceLines(input: PresenceLinesInput): { details: string; state: string } {
  const label = input.episodeLabel?.trim() || `E${String(Math.max(0, Math.trunc(input.episodeNumber))).padStart(2, '0')}`;
  const episodeTitle = input.episodeTitle?.trim();
  const isMovie = /^M\d+$/i.test(label);
  let state = episodeTitle && !isMovie ? `${label} - ${episodeTitle}` : label;
  if (input.status === 'paused') state += ' · Paused';
  return { details: `Watching ${input.title}`, state };
}

export interface ThemePresenceLinesInput {
  // "OP1" / "ED2" — the fallback when the song has no known title.
  themeLabel: string;
  songTitle?: string | null;
  artists?: string | null;
  mediaTitle: string;
  status: PresenceStatus;
}

// Discord's two lines for a media-page theme: `Listening <song>` (or the
// OP/ED label) / `<artists> · <media title>` with ` · Paused` while paused.
export function formatThemePresenceLines(input: ThemePresenceLinesInput): { details: string; state: string } {
  const song = input.songTitle?.trim() || input.themeLabel;
  const parts = [input.artists?.trim(), input.mediaTitle.trim()].filter((part): part is string => !!part);
  let state = parts.join(' · ');
  if (input.status === 'paused') state = state ? `${state} · Paused` : 'Paused';
  return { details: `Listening ${song}`, state };
}

export interface PresenceSnapshot {
  status: PresenceStatus;
  // Unix seconds; absent while the duration is unknown or when paused.
  startTime?: number;
  endTime?: number;
}

// Drift (seconds) before an otherwise-equal timestamp pair is re-sent — a
// real seek, a speed change or a late-arriving duration all exceed it,
// ordinary tick jitter never does.
export const PRESENCE_DRIFT_SECONDS = 4;

// Wall-clock start/end for the "elapsed / remaining" display. `speed`
// stretches what is left: at 2× a 40 s remainder ends 20 s from now. Null
// while the duration is unknown (mpv reports 0 until the demuxer knows).
export function computePresenceTimestamps(
  nowSec: number,
  timeSecs: number,
  lengthSecs: number,
  speed = 1,
): { startTime: number; endTime: number } | null {
  if (!Number.isFinite(lengthSecs) || lengthSecs <= 0) return null;
  const rate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const time = Math.max(0, Math.min(timeSecs, lengthSecs));
  const startTime = Math.round(nowSec - time / rate);
  const endTime = Math.round(nowSec + (lengthSecs - time) / rate);
  return { startTime, endTime };
}

export function buildPresenceSnapshot(
  status: PresenceStatus,
  nowSec: number,
  timeSecs: number,
  lengthSecs: number,
  speed = 1,
): PresenceSnapshot {
  if (status !== 'playing') return { status: 'paused' };
  const stamps = computePresenceTimestamps(nowSec, timeSecs, lengthSecs, speed);
  return stamps ? { status: 'playing', ...stamps } : { status: 'playing' };
}

// True when `next` differs from what Discord last got: a status flip is
// always sent at once; timestamps only when start or end drifted, or when
// they appear/disappear (duration learned, or lost).
export function shouldResendPresence(prev: PresenceSnapshot | null, next: PresenceSnapshot): boolean {
  if (!prev) return true;
  if (prev.status !== next.status) return true;
  const prevHas = prev.startTime != null && prev.endTime != null;
  const nextHas = next.startTime != null && next.endTime != null;
  if (prevHas !== nextHas) return true;
  if (!nextHas) return false;
  return Math.abs((prev.startTime ?? 0) - (next.startTime ?? 0)) > PRESENCE_DRIFT_SECONDS
    || Math.abs((prev.endTime ?? 0) - (next.endTime ?? 0)) > PRESENCE_DRIFT_SECONDS;
}
