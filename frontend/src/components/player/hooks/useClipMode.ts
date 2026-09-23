import { useCallback, useEffect, useRef, useState } from 'react';
import type { Translations } from '../../../i18n/index';
import { formatAppError } from '../../../lib/errors/format-error';
import { initialClipRange, moveClipEnd, moveClipStart, type ClipRange } from '../../../lib/player/clip-range';
import { getLastClipChoice, rememberClipChoice } from '../../../lib/player/clip-choice';
import { isPlayerError, type PlayerStatus } from '../../../lib/player/player-status';
import {
  listenClipProgress, playerClipCancel, playerClipExport, playerSeek, playerSetAbLoop, type ClipFormat, type ClipResult, type ClipSize,
  type Unlisten,
} from '../../../lib/tauri/player';

export interface ClipOptions {
  format: ClipFormat;
  size: ClipSize;
  includeAudio: boolean;
  burnSubtitles: boolean;
}

// trimming: handles on the bar; choosing: format/size chooser after the
// trim is confirmed (the selection keeps looping); exporting: encoding.
export type ClipPhase = 'idle' | 'trimming' | 'choosing' | 'exporting';

const CANCELLED = 'E_CLIP_CANCELLED';

function swallow(promise: Promise<unknown>) {
  promise.catch(err => console.error('Clip command failed', err));
}

// Clip mode behind the scissors button: the 3–10 s selection on the seek
// bar (looped in mpv with ab-loop while choosing), the export options, the
// export itself (Rust, on its own libmpv handle) and its outcome.
export function useClipMode(status: PlayerStatus, t: Pick<Translations, 'errors'>) {
  const [phase, setPhase] = useState<ClipPhase>('idle');
  const [range, setRangeState] = useState<ClipRange>({ start: 0, end: 0 });
  // Handle drags fire faster than renders: the latest range lives here too.
  const rangeRef = useRef<ClipRange>(range);
  const setRange = useCallback((next: ClipRange) => {
    rangeRef.current = next;
    setRangeState(next);
  }, []);
  const [options, setOptions] = useState<ClipOptions>({ format: 'mp4', size: '480p', includeAudio: true, burnSubtitles: false });
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ClipResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  });

  // Loop the selection while trimming/choosing; stop as soon as we leave.
  const looping = phase === 'trimming' || phase === 'choosing';
  useEffect(() => {
    if (!looping) return;
    const timer = window.setTimeout(() => swallow(playerSetAbLoop(range.start, range.end)), 80);
    return () => window.clearTimeout(timer);
  }, [looping, range.start, range.end]);
  useEffect(() => {
    if (looping) return () => swallow(playerSetAbLoop(null, null));
  }, [looping]);

  useEffect(() => {
    if (phase !== 'exporting') return;
    let disposed = false;
    let unlisten: Unlisten | null = null;
    listenClipProgress(next => setProgress(next.fraction)).then(stop => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(err => console.error('Clip progress subscription failed', err));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [phase]);

  const enter = useCallback(() => {
    const current = statusRef.current;
    if (current.duration_secs <= 0) return;
    const last = getLastClipChoice();
    const subtitlesShown = current.tracks.some(track => track.kind === 'sub' && track.selected);
    setOptions({ ...last, burnSubtitles: subtitlesShown });
    setRange(initialClipRange(current.position_secs, current.duration_secs));
    setResult(null);
    setError(null);
    setPhase('trimming');
  }, [setRange]);

  const cancel = useCallback(() => setPhase(phase => (phase === 'trimming' || phase === 'choosing' ? 'idle' : phase)), []);
  /** Trim confirmed (Enter / Done): show the format chooser. */
  const confirmTrim = useCallback(() => setPhase(phase => (phase === 'trimming' ? 'choosing' : phase)), []);
  /** Back from the chooser to the handles. */
  const backToTrim = useCallback(() => setPhase(phase => (phase === 'choosing' ? 'trimming' : phase)), []);

  const setStart = useCallback((secs: number, seek = true) => {
    const next = moveClipStart(rangeRef.current, secs, statusRef.current.duration_secs);
    setRange(next);
    if (seek) swallow(playerSeek(next.start, false));
  }, [setRange]);

  const setEnd = useCallback((secs: number) => {
    setRange(moveClipEnd(rangeRef.current, secs, statusRef.current.duration_secs));
  }, [setRange]);

  const markStart = useCallback(() => setStart(statusRef.current.position_secs, false), [setStart]);
  const markEnd = useCallback(() => setEnd(statusRef.current.position_secs), [setEnd]);

  const exportClip = useCallback(() => {
    if (phase !== 'choosing') return;
    rememberClipChoice({ format: options.format, size: options.size, includeAudio: options.includeAudio });
    setPhase('exporting');
    setProgress(0);
    playerClipExport({
      startSecs: range.start,
      endSecs: range.end,
      format: options.format,
      size: options.size,
      includeAudio: options.format === 'mp4' && options.includeAudio,
      burnSubtitles: options.burnSubtitles,
    })
      .then(done => setResult(done))
      .catch(err => {
        const code = isPlayerError(err) ? err.code : null;
        if (code === CANCELLED) return;
        const raw = isPlayerError(err) ? `${err.code}${err.detail ? `: ${err.detail}` : ''}` : err;
        setError(formatAppError(raw, t));
      })
      .finally(() => setPhase('idle'));
  }, [phase, range, options, t]);

  const cancelExport = useCallback(() => swallow(playerClipCancel()), []);
  const dismissResult = useCallback(() => setResult(null), []);
  const dismissError = useCallback(() => setError(null), []);

  return {
    phase, range, options, setOptions, progress, result, error,
    enter, cancel, confirmTrim, backToTrim, setStart, setEnd, markStart, markEnd, exportClip, cancelExport, dismissResult, dismissError,
  };
}

export type ClipMode = ReturnType<typeof useClipMode>;
