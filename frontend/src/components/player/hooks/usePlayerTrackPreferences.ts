import { useCallback, useEffect, useReducer, useRef } from 'react';
import { getLangCode } from '../../../i18n/runtime';
import { getTrackPreferences } from '../../../lib/player/player-settings';
import type { PlayerSessionInfo, PlayerStatus, PlayerTrack } from '../../../lib/player/player-status';
import { forgetTrackMemory, getTrackMemory, rememberTrack, takeManualCycle } from '../../../lib/player/track-memory';
import { chooseTracks, hintFor, isAnimeExternalId } from '../../../lib/player/track-preferences';
import { playerSetTrack } from '../../../lib/tauri/player';

/** Tracks settle a moment after `path` changes (mpv re-sends track-list). */
const SETTLE_MS = 300;

type TrackKind = 'audio' | 'sub';

function selectedOf(tracks: readonly PlayerTrack[], kind: TrackKind): PlayerTrack | null {
  return tracks.find(track => track.kind === kind && track.selected) ?? null;
}

function tracksSignature(tracks: readonly PlayerTrack[]): string {
  return tracks.map(track => `${track.kind}:${track.id}:${track.lang ?? ''}:${track.title ?? ''}`).join('|');
}

function apply(status: PlayerStatus, externalId: string | null): void {
  const choice = chooseTracks(status.tracks, {
    preferences: getTrackPreferences(),
    appLanguage: getLangCode(),
    isAnime: isAnimeExternalId(externalId),
    memory: getTrackMemory(externalId),
  });
  for (const kind of ['audio', 'sub'] as const) {
    const wanted = choice[kind];
    if (wanted === undefined) continue;
    const current = selectedOf(status.tracks, kind)?.id ?? null;
    if (current === wanted) continue;
    playerSetTrack(kind, wanted).catch(err => console.error('Automatic track selection failed', err));
  }
}

// Smart default audio/subtitles (lib/player/track-preferences.ts): applied
// once per file when its track list is known; hand-picked tracks are
// remembered for the series and override the rule on later episodes.
export function usePlayerTrackPreferences(status: PlayerStatus, session: PlayerSessionInfo | null) {
  const externalId = session?.external_id ?? null;
  const appliedPath = useRef<string | null>(null);
  const statusRef = useRef(status);
  // Re-render after a menu pick / reset so the "Reset" item shows or hides
  // at once; keyboard cycles show up through the next status tick.
  const [, memoryChanged] = useReducer((count: number) => count + 1, 0);
  const hasMemory = getTrackMemory(externalId) !== null;
  const signature = tracksSignature(status.tracks);

  useEffect(() => {
    statusRef.current = status;
  });

  useEffect(() => {
    const path = status.path;
    if (!path || status.tracks.length === 0 || appliedPath.current === path) return;
    const timer = window.setTimeout(() => {
      const latest = statusRef.current;
      if (latest.path !== path || latest.tracks.length === 0) return;
      appliedPath.current = path;
      apply(latest, externalId);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
    // `signature` stands in for the track list (a new array every tick).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.path, signature, externalId]);

  // C / A keys: record whatever the cycle landed on once it shows up.
  const selectedAudio = selectedOf(status.tracks, 'audio');
  const selectedSub = selectedOf(status.tracks, 'sub');
  const audioKey = selectedAudio?.id ?? null;
  const subKey = selectedSub?.id ?? null;
  useEffect(() => {
    if (!externalId || !takeManualCycle('audio')) return;
    rememberTrack(externalId, 'audio', selectedAudio ? hintFor(selectedAudio) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioKey]);
  useEffect(() => {
    if (!externalId || !takeManualCycle('sub')) return;
    rememberTrack(externalId, 'sub', selectedSub ? hintFor(selectedSub) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subKey]);

  /** A pick from the audio/subtitle menu (`null` = off). */
  const rememberManual = useCallback((kind: TrackKind, track: PlayerTrack | null) => {
    if (!externalId) return;
    rememberTrack(externalId, kind, track ? hintFor(track) : null);
    memoryChanged();
  }, [externalId]);

  /** "Reset for this series": forget the picks and re-apply the rule now. */
  const resetMemory = useCallback(() => {
    forgetTrackMemory(externalId);
    memoryChanged();
    apply(statusRef.current, externalId);
  }, [externalId]);

  return { hasMemory, rememberManual, resetMemory };
}
