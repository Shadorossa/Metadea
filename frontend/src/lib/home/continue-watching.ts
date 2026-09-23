// Home's "Continue watching" card: picks the single last thing watched out
// of the raw candidates get_continue_watching_sources returns (resume
// positions, watched-episode history, the built-in player's stop frames),
// and the small labels/URL the card needs. Pure — tested in
// continue-watching.test.ts.
import { LOCAL_CATEGORY_BY_MEDIA_TYPE } from '../local/platforms';
import { interpolate } from '../shared/text/interpolate';

export interface ContinueWatchingSources {
  resume: Array<{ external_id: string; episode_number: number; position_seconds: number; updated_at: string }>;
  history: Array<{ external_id: string; episode_number: number; watched_at: string }>;
  frames: Array<{
    external_id: string;
    episode_number: number;
    frame_path: string | null;
    position_seconds: number;
    duration_seconds: number;
    updated_at: string;
  }>;
  episodes: Array<{ external_id: string; episode_number: number; season_number: number; name: string | null; cover_url: string | null }>;
}

export interface LastWatched {
  externalId: string;
  episodeNumber: number;
  /** Season from the cached episode list; null when unknown or 0. */
  seasonNumber: number | null;
  episodeTitle: string | null;
  /** Built-in player's frame at the stop point (a local file path). */
  framePath: string | null;
  /** Provider still for the episode (TMDB/AniList), when cached. */
  stillUrl: string | null;
  positionSeconds: number;
  /** Known only for built-in player sessions. */
  durationSeconds: number | null;
  /** Epoch ms of the activity that made it the latest. */
  updatedAt: number;
}

/** SQLite's CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC) or an ISO string, as epoch ms (NaN if unparseable). */
export function parseDbTimestamp(value: string): number {
  const sqlite = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(value.trim());
  return sqlite ? Date.parse(`${sqlite[1]}T${sqlite[2]}Z`) : Date.parse(value);
}

const key = (externalId: string, episode: number) => `${externalId}#${episode}`;

/** The most recent candidate: a resume/frame stop resumes that episode at
 *  its position; a finished episode (history) points at the next one, from
 *  the start. Null when nothing was ever watched locally. `nextEpisode`
 *  picks the episode after a finished one (an anime set to "Filler: Skipped" jumps
 *  to its next canon episode — lib/anime/filler.ts's nextCanonEpisode). */
export function pickLastWatched(
  sources: ContinueWatchingSources,
  nextEpisode: (externalId: string, finishedEpisode: number) => number = (_, finished) => finished + 1,
): LastWatched | null {
  const frames = new Map(sources.frames.map(f => [key(f.external_id, f.episode_number), f]));
  const resumes = new Map(sources.resume.map(r => [key(r.external_id, r.episode_number), r]));
  const episodes = new Map(sources.episodes.map(e => [key(e.external_id, e.episode_number), e]));

  type Candidate = { externalId: string; episode: number; at: number; position: number };
  const candidates: Candidate[] = [
    ...sources.resume.map(r => ({ externalId: r.external_id, episode: r.episode_number, at: parseDbTimestamp(r.updated_at), position: r.position_seconds })),
    ...sources.frames.map(f => ({ externalId: f.external_id, episode: f.episode_number, at: parseDbTimestamp(f.updated_at), position: f.position_seconds })),
    ...sources.history.map(h => ({ externalId: h.external_id, episode: nextEpisode(h.external_id, h.episode_number), at: parseDbTimestamp(h.watched_at), position: 0 })),
  ].filter(c => Number.isFinite(c.at));
  if (candidates.length === 0) return null;

  const latest = candidates.reduce((best, c) => (c.at > best.at ? c : best));
  const k = key(latest.externalId, latest.episode);
  const frame = frames.get(k);
  const resume = resumes.get(k);
  const meta = episodes.get(k);
  // The resume row is the most precise position once both exist (it keeps
  // being updated while watching); a finished episode's next one starts at 0.
  const position = latest.position === 0 && !frame && !resume ? 0 : (resume?.position_seconds ?? frame?.position_seconds ?? latest.position);
  return {
    externalId: latest.externalId,
    episodeNumber: latest.episode,
    seasonNumber: meta && meta.season_number > 0 ? meta.season_number : null,
    episodeTitle: meta?.name ?? null,
    framePath: frame?.frame_path ?? null,
    stillUrl: meta?.cover_url ?? null,
    positionSeconds: position,
    durationSeconds: frame && frame.duration_seconds > 0 ? frame.duration_seconds : null,
    updatedAt: latest.at,
  };
}

export interface ContinueStrings {
  continue_episode: string;
  continue_season_episode: string;
  continue_remaining_minutes: string;
  continue_remaining_hours: string;
}

const formatEpisodeNumber = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace('.', ','));

/** "E13" / "S1 · E13" (localized), plus " — <title>" when known. */
export function episodeLine(item: Pick<LastWatched, 'episodeNumber' | 'seasonNumber' | 'episodeTitle'>, strings: ContinueStrings): string {
  const episode = formatEpisodeNumber(item.episodeNumber);
  const label = item.seasonNumber
    ? interpolate(strings.continue_season_episode, { season: item.seasonNumber, episode })
    : interpolate(strings.continue_episode, { episode });
  return item.episodeTitle ? `${label} — ${item.episodeTitle}` : label;
}

/** Share of the episode already watched (0–1), or null without a duration. */
export function watchedFraction(position: number, duration: number | null): number | null {
  if (!duration || duration <= 0) return null;
  return Math.min(1, Math.max(0, position / duration));
}

/** "12 min left" / "1 h 5 min left" (localized); null without a duration. */
export function remainingLabel(position: number, duration: number | null, strings: ContinueStrings): string | null {
  if (!duration || duration <= 0) return null;
  const minutes = Math.max(1, Math.ceil((duration - position) / 60));
  if (minutes < 60) return interpolate(strings.continue_remaining_minutes, { minutes });
  return interpolate(strings.continue_remaining_hours, { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** Local's own "resume" entry point (the same URL a library card's quick
 *  action builds): Local opens the work's panel and starts its next episode
 *  from the saved position — or just opens the panel when the file is gone.
 *  Null for media types Local doesn't handle. */
export function buildLocalResumeUrl(externalId: string, mediaType: string): string | null {
  const category = LOCAL_CATEGORY_BY_MEDIA_TYPE[mediaType];
  if (!category) return null;
  const params = new URLSearchParams({ type: category, resume: externalId });
  return `/local?${params.toString()}`;
}
