import { useRef, useState } from 'react';
import { formatClock } from '../../lib/player/format-time';
import { segmentKey, type SkipSegment } from '../../lib/player/skip-segments';
import { playerSeek } from '../../lib/tauri/player';

interface Props {
  positionSecs: number;
  durationSecs: number;
  seekLabel: string; // "Ir a {time}"
  // Skippable intervals, drawn as translucent bands on the track.
  segments?: SkipSegment[];
}

// Native range input (keyboard accessible) with a hover time tooltip. While
// the thumb is being dragged the local value wins over incoming status
// ticks so the bar does not fight the user.
export function PlayerSeekBar({ positionSecs, durationSecs, seekLabel, segments = [] }: Props) {
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [hover, setHover] = useState<{ fraction: number; secs: number } | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);

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
    setHover({ fraction: f, secs: f * max });
  };

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
        onPointerUp={event => commit(Number(event.currentTarget.value))}
        onKeyUp={event => {
          if (dragValue !== null) commit(Number(event.currentTarget.value));
        }}
        onBlur={() => { if (dragValue !== null) commit(dragValue); }}
      />
      {hover && (
        <div className="player-seek__tooltip" style={{ left: `${hover.fraction * 100}%` }} aria-hidden="true">
          {formatClock(hover.secs, max >= 3600)}
        </div>
      )}
    </div>
  );
}
