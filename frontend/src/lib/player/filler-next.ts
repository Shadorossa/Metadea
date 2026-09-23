// "Next canon episode" for the built-in player when the library entry is
// set to "Filler: Skipped". The main window sends the queue's filler
// episodes with the session (playback-service → player_open); the controls
// window, which has no filler store of its own, rebuilds a minimal
// FillerInfo from them and asks lib/anime/filler.ts's nextCanonEpisode.
// Pure: no React, no Tauri.

import { nextCanonEpisode, type FillerInfo } from '../anime/filler';

export interface NextCanonInQueue {
  /** Entry episode number to jump to. */
  episode: number;
  /** Filler episodes jumped over. */
  skipped: number;
  /** Its position in the player queue. */
  queueIndex: number;
}

/** A FillerInfo whose only filler episodes are `episodes` (entry numbering). */
export function fillerInfoFromEpisodes(externalId: string, episodes: readonly number[]): FillerInfo {
  const whole = episodes.filter(episode => Number.isInteger(episode) && episode > 0);
  const sorted = [...new Set(whole)].sort((a, b) => a - b);
  return {
    externalId,
    slug: '',
    title: '',
    episodeOffset: 0,
    manual: false,
    confidence: 1,
    lastEpisode: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
    isAiring: false,
    fetchedAt: null,
    kinds: new Map(sorted.map(episode => [episode, 'filler' as const])),
    fillerAbsolute: sorted,
  };
}

/**
 * The canon episode to offer after queue entry `index`, when the episode
 * right after it is filler and the canon one is in the queue; null when the
 * next episode is canon anyway, nothing canon is queued, or there is no
 * filler data for the session.
 */
export function nextCanonInQueue(
  externalId: string | null | undefined,
  episodeNumbers: readonly number[],
  fillerEpisodes: readonly number[] | null | undefined,
  index: number,
): NextCanonInQueue | null {
  if (!externalId || !fillerEpisodes || fillerEpisodes.length === 0) return null;
  const current = episodeNumbers[index];
  if (current === undefined) return null;
  const next = nextCanonEpisode(current, fillerInfoFromEpisodes(externalId, fillerEpisodes));
  if (next.episode === null || next.skipped === 0) return null;
  const queueIndex = episodeNumbers.indexOf(next.episode);
  return queueIndex > index ? { episode: next.episode, skipped: next.skipped, queueIndex } : null;
}

/** Seconds before the end at which the card appears (unless an ending
 *  segment starts earlier). */
export const FILLER_CARD_LEAD_SECS = 45;

export function shouldShowFillerCard(positionSecs: number, durationSecs: number, inEnding: boolean): boolean {
  if (durationSecs <= 0) return false;
  return inEnding || durationSecs - positionSecs <= FILLER_CARD_LEAD_SECS;
}
