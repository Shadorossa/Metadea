import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayerChapter } from '../../../lib/player/player-status';
import { getSkipMode, type PlayerSkipMode } from '../../../lib/player/player-settings';
import { resolveMalId } from '../../../lib/player/mal-id';
import {
  createAutoSkipTracker, mergeSegments, resolveActiveSegment, segmentsFromAniskip, segmentsFromChapters, type SkipSegment,
} from '../../../lib/player/skip-segments';
import { aniskipGetSegments } from '../../../lib/tauri/aniskip';
import { playerSeek } from '../../../lib/tauri/player';

interface Options {
  externalId: string | null | undefined;
  episodeNumber: number | null | undefined;
  durationSecs: number;
  positionSecs: number;
  chapters: PlayerChapter[];
  // The lookup only runs while something is loaded.
  enabled?: boolean;
}

export interface AutoSkipNotice {
  segment: SkipSegment;
  // Bumps on every auto-skip so a new file with equal segment times still
  // re-triggers the toast.
  token: number;
  // The episode the skip happened in; a notice from another episode is
  // never shown (the queue advanced before it was dismissed).
  episodeKey: string;
}

const EMPTY_SEGMENTS: SkipSegment[] = [];

function episodeKeyOf(externalId: string | null | undefined, episodeNumber: number | null | undefined): string {
  return `${externalId ?? ''}#${episodeNumber ?? ''}`;
}

// Skip segments for what is playing: MKV chapters first (offline, from the
// engine's `chapter-list`), AniSkip second (needs the work's MAL id and the
// episode length; failures are silent). Exposes the segment the position is
// inside — with hysteresis so the button does not blink at the edges — and
// the skip action itself. In `auto` mode the first entry into each segment
// seeks past it and reports it so the shell can show an Undo toast.
export function usePlayerSkipSegments({ externalId, episodeNumber, durationSecs, positionSecs, chapters, enabled = true }: Options) {
  const [skipMode] = useState<PlayerSkipMode>(() => getSkipMode());
  // AniSkip results tagged with the request they answer, so a stale answer
  // (previous episode) is never shown against the current one.
  const [aniskipResult, setAniskipResult] = useState<{ key: string; segments: SkipSegment[] } | null>(null);
  const [notice, setNotice] = useState<AutoSkipNotice | null>(null);
  const episodeKey = episodeKeyOf(externalId, episodeNumber);
  const autoSkipped = notice && notice.episodeKey === episodeKey ? notice : null;
  const tracker = useRef(createAutoSkipTracker());
  const noticeToken = useRef(0);

  const chapterSegments = useMemo(() => segmentsFromChapters(chapters, durationSecs), [chapters, durationSecs]);

  // AniSkip buckets the length itself; only refetch when the episode
  // changes or the duration moves to a different minute.
  const lengthKey = Math.round(durationSecs / 60);
  const requestKey = `${episodeKey}@${lengthKey}`;
  useEffect(() => {
    if (!enabled || skipMode === 'off' || !externalId || !episodeNumber || durationSecs <= 0) return;
    let disposed = false;
    (async () => {
      const malId = await resolveMalId(externalId);
      if (!malId || disposed) return;
      const results = await aniskipGetSegments(malId, episodeNumber, durationSecs);
      if (!disposed) setAniskipResult({ key: requestKey, segments: segmentsFromAniskip(results) });
    })().catch(err => console.debug('Skip segment lookup failed', err));
    return () => { disposed = true; };
    // `durationSecs` is only read through its bucket (`requestKey`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, skipMode, externalId, episodeNumber, requestKey]);
  const aniskipSegments = aniskipResult?.key === requestKey ? aniskipResult.segments : EMPTY_SEGMENTS;

  // A new episode starts every segment's auto-skip afresh.
  useEffect(() => {
    tracker.current.reset();
  }, [episodeKey]);

  const segments = useMemo(
    () => (skipMode === 'off' ? [] : mergeSegments(chapterSegments, aniskipSegments)),
    [skipMode, chapterSegments, aniskipSegments],
  );

  // The active segment depends on the one offered a tick ago (hysteresis),
  // so it is state derived during render from the inputs that changed.
  const [tracked, setTracked] = useState<{ segments: SkipSegment[]; positionSecs: number; active: SkipSegment | null }>({
    segments, positionSecs, active: null,
  });
  if (tracked.segments !== segments || tracked.positionSecs !== positionSecs) {
    setTracked({ segments, positionSecs, active: resolveActiveSegment(segments, positionSecs, tracked.active) });
  }
  const active = tracked.active;

  useEffect(() => {
    if (skipMode !== 'auto' || !enabled) return;
    const segment = tracker.current.next(segments, positionSecs);
    if (!segment) return;
    playerSeek(segment.endSecs, false).catch(err => console.debug('Auto-skip seek failed', err));
    noticeToken.current += 1;
    setNotice({ segment, token: noticeToken.current, episodeKey });
  }, [skipMode, enabled, segments, positionSecs, episodeKey]);

  const skip = useCallback(() => {
    if (!active) return;
    tracker.current.markHandled(active);
    playerSeek(active.endSecs, false).catch(err => console.error('Skip seek failed', err));
  }, [active]);

  const undoAutoSkip = useCallback(() => {
    if (!autoSkipped) return;
    playerSeek(autoSkipped.segment.startSecs, false).catch(err => console.error('Undo skip seek failed', err));
    setNotice(null);
  }, [autoSkipped]);

  const dismissAutoSkip = useCallback(() => setNotice(null), []);

  return { segments, activeSegment: active, skip, skipMode, autoSkipped, undoAutoSkip, dismissAutoSkip };
}
