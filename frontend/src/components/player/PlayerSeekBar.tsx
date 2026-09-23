import { useEffect, useRef, useState } from 'react';
import { formatClock } from '../../lib/player/format-time';
import type { PlayerChapter } from '../../lib/player/player-status';
import {
  chapterAt, clampPreviewLeft, EXACT_REQUEST_DEBOUNCE_MS, PREVIEW_WIDTH_PX, previewHeight,
} from '../../lib/player/seek-preview';
import { segmentKey, type SkipSegment } from '../../lib/player/skip-segments';
import { playerSeek } from '../../lib/tauri/player';
import type { ClipRange } from '../../lib/player/clip-range';
import { PlayerClipSelection } from './PlayerClipSelection';
import { PlayerSeekPreview } from './PlayerSeekPreview';
import { useSeekThumbnails } from './hooks/useSeekThumbnails';

interface Props {
  positionSecs: number;
  durationSecs: number;
  seekLabel: string; // "Ir a {time}"
  // Skippable intervals, drawn as translucent bands on the track.
  segments?: SkipSegment[];
  // File playing (hover thumbnails) and its chapters (name under the time).
  path?: string | null;
  chapters?: PlayerChapter[];
  // Clip mode (scissors): the selection and its handles over the bar.
  clip?: ClipSelectionProps | null;
}

export interface ClipSelectionProps {
  range: ClipRange;
  onStart: (secs: number) => void;
  onEnd: (secs: number) => void;
  startLabel: string;
  endLabel: string;
}

interface Hover {
  fraction: number;
  secs: number;
  clientX: number;
  pointerType: string;
}

// Bar and player edges (viewport px), captured on pointer move so the
// preview can be placed and clamped without reading layout in render.
interface Geometry {
  barLeft: number;
  barWidth: number;
  boundsLeft: number;
  boundsRight: number;
}

// Native range input (keyboard accessible) with a hover time tooltip — or,
// when seek-bar thumbnails are on, a frame preview with the time and the
// chapter. While the thumb is being dragged the local value wins over
// incoming status ticks so the bar does not fight the user.
export function PlayerSeekBar({ positionSecs, durationSecs, seekLabel, segments = [], path = null, chapters = [], clip = null }: Props) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  // Mouse/pen drag on the thumb: the preview follows the value even when
  // the pointer leaves the bar. Keyboard seeking never sets it.
  const [scrubbing, setScrubbing] = useState(false);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbnails = useSeekThumbnails(path);

  const max = Math.max(durationSecs, 0);
  const value = dragValue ?? Math.min(positionSecs, max);
  const fraction = max > 0 ? value / max : 0;

  const commit = (secs: number) => {
    setDragValue(null);
    playerSeek(secs, false).catch(err => console.error('Seek failed', err));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || max <= 0) return;
    const f = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setHover({ fraction: f, secs: f * max, clientX: event.clientX, pointerType: event.pointerType });
    const bounds = trackRef.current?.closest('.player-overlay')?.getBoundingClientRect();
    setGeometry({
      barLeft: rect.left,
      barWidth: rect.width,
      boundsLeft: bounds?.left ?? 0,
      boundsRight: bounds?.right ?? window.innerWidth,
    });
  };

  useEffect(() => {
    if (!scrubbing) return;
    const stop = () => setScrubbing(false);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
  }, [scrubbing]);

  // What the preview shows: the dragged value while scrubbing, else the
  // hovered spot. Touch gets no preview (no hover, finger on top of it).
  const previewSecs = scrubbing && dragValue !== null ? dragValue : hover && hover.pointerType !== 'touch' ? hover.secs : null;
  const showPreview = thumbnails.available && max > 0 && previewSecs !== null;

  const { needsExact, requestExact } = thumbnails;
  useEffect(() => {
    if (!showPreview || previewSecs === null || !needsExact(previewSecs)) return;
    const timer = window.setTimeout(() => requestExact(previewSecs), EXACT_REQUEST_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [showPreview, previewSecs, needsExact, requestExact]);

  let preview: React.ReactNode = null;
  if (showPreview && previewSecs !== null && geometry) {
    const pointerX = scrubbing && dragValue !== null
      ? geometry.barLeft + (dragValue / max) * geometry.barWidth
      : hover?.clientX ?? geometry.barLeft;
    const width = PREVIEW_WIDTH_PX;
    const height = previewHeight(thumbnails.grid, width);
    const left = clampPreviewLeft(pointerX, width, geometry.barLeft, geometry.boundsLeft, geometry.boundsRight);
    const chapter = chapters.length > 0 ? chapterAt(chapters, previewSecs)?.title?.trim() || null : null;
    preview = (
      <PlayerSeekPreview
        left={left}
        width={width}
        height={height}
        image={thumbnails.imageFor(previewSecs, width, height)}
        time={formatClock(previewSecs, max >= 3600)}
        chapter={chapter}
      />
    );
  }

  return (
    <div
      ref={trackRef}
      className="player-seek"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
      style={{ '--player-seek-fraction': fraction } as React.CSSProperties}
    >
      <div className="player-seek__track" aria-hidden="true">
        <div className="player-seek__fill" />
        {max > 0 && segments.map(segment => (
          <div
            key={segmentKey(segment)}
            className={`player-seek__segment player-seek__segment--${segment.kind}`}
            style={{
              left: `${Math.min(100, Math.max(0, (segment.startSecs / max) * 100))}%`,
              width: `${Math.max(0, (Math.min(segment.endSecs, max) - Math.max(segment.startSecs, 0)) / max) * 100}%`,
            }}
          />
        ))}
      </div>
      <input
        type="range"
        className="player-seek__input"
        min={0}
        max={max || 1}
        step={0.1}
        value={value}
        disabled={max <= 0}
        aria-label={seekLabel.replace('{time}', formatClock(value))}
        aria-valuetext={formatClock(value)}
        onChange={event => setDragValue(Number(event.currentTarget.value))}
        onPointerDown={event => { if (event.pointerType !== 'touch') setScrubbing(true); }}
        onPointerUp={event => {
          setScrubbing(false);
          commit(Number(event.currentTarget.value));
        }}
        onKeyUp={event => {
          if (dragValue !== null) commit(Number(event.currentTarget.value));
        }}
        onBlur={() => {
          setScrubbing(false);
          if (dragValue !== null) commit(dragValue);
        }}
      />
      {clip && max > 0 && <PlayerClipSelection durationSecs={max} barRef={trackRef} {...clip} />}
      {preview}
      {hover && !thumbnails.available && (
        <div className="player-seek__tooltip" style={{ left: `${hover.fraction * 100}%` }} aria-hidden="true">
          {formatClock(hover.secs, max >= 3600)}
        </div>
      )}
    </div>
  );
}
