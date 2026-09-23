// The affinity ring in the taste comparison modal: a track plus a glowing
// gradient arc for the 0-100 score that sweeps up on open (CSS, same
// duration as the count-up number; static with reduced motion).
import { useId, type CSSProperties } from 'react';

const RADIUS = 15;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function TasteRing({ score, className }: { score: number; className: string }) {
  const gradientId = `taste-ring-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const fraction = Math.max(0, Math.min(100, score)) / 100;
  const style = {
    '--taste-ring-circumference': CIRCUMFERENCE,
    '--taste-ring-offset': CIRCUMFERENCE * (1 - fraction),
  } as CSSProperties;
  return (
    <svg className={`taste-ring ${className}`} viewBox="0 0 36 36" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" className="taste-ring-stop-start" />
          <stop offset="100%" className="taste-ring-stop-end" />
        </linearGradient>
      </defs>
      <circle className="taste-ring-track" cx="18" cy="18" r={RADIUS} />
      <circle
        className="taste-ring-value"
        cx="18" cy="18" r={RADIUS}
        stroke={`url(#${gradientId})`}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={CIRCUMFERENCE * (1 - fraction)}
        style={style}
      />
    </svg>
  );
}
