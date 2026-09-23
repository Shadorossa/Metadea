import { useRef } from 'react';
import type { ClipRange } from '../../lib/player/clip-range';

interface Props {
  range: ClipRange;
  durationSecs: number;
  // The seek bar element: handles map pointer x to time over its width.
  barRef: React.RefObject<HTMLDivElement | null>;
  onStart: (secs: number) => void;
  onEnd: (secs: number) => void;
  startLabel: string;
  endLabel: string;
}

function percent(secs: number, durationSecs: number): string {
  return `${Math.min(100, Math.max(0, (secs / durationSecs) * 100))}%`;
}

interface HandleProps {
  edge: 'start' | 'end';
  secs: number;
  durationSecs: number;
  barRef: React.RefObject<HTMLDivElement | null>;
  onMove: (secs: number) => void;
  label: string;
}

// One draggable edge: pointer capture keeps the drag alive off the bar.
function ClipHandle({ edge, secs, durationSecs, barRef, onMove, label }: HandleProps) {
  const dragging = useRef(false);
  return (
    <div
      className={`player-clip-selection__handle player-clip-selection__handle--${edge}`}
      style={{ left: percent(secs, durationSecs) }}
      title={label}
      onPointerDown={event => {
        event.preventDefault();
        event.stopPropagation();
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!dragging.current) return;
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return;
        onMove(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * durationSecs);
      }}
      onPointerUp={event => {
        dragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
    />
  );
}

// Clip mode overlay on the seek bar: the selected span and its two
// draggable handles. Drawn on top of the bar without touching it; only
// present while clip mode is on.
export function PlayerClipSelection({ range, durationSecs, barRef, onStart, onEnd, startLabel, endLabel }: Props) {
  if (durationSecs <= 0) return null;
  const left = percent(range.start, durationSecs);
  return (
    <div className="player-clip-selection" aria-hidden="true">
      <div className="player-clip-selection__span" style={{ left, width: `calc(${percent(range.end, durationSecs)} - ${left})` }} />
      <ClipHandle edge="start" secs={range.start} durationSecs={durationSecs} barRef={barRef} onMove={onStart} label={startLabel} />
      <ClipHandle edge="end" secs={range.end} durationSecs={durationSecs} barRef={barRef} onMove={onEnd} label={endLabel} />
    </div>
  );
}
