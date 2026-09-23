// One confetti burst from the score ring when the modal opens on a very
// high score. Pieces are deterministic (no Math.random) so renders are
// stable; CSS hides the layer entirely with reduced motion.
import type { CSSProperties } from 'react';

const PIECES = 30;
const COLORS = ['var(--accent)', 'var(--taste-rose)', 'var(--color-gold-soft)', 'var(--color-completed)', 'var(--color-paused)'];

// Cheap deterministic 0-1 noise per piece.
function noise(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function TasteConfetti() {
  return (
    <span className="taste-confetti" aria-hidden="true">
      {Array.from({ length: PIECES }, (_, i) => {
        const angle = (i / PIECES) * 2 * Math.PI + noise(i, 1) * 0.4;
        const distance = 70 + noise(i, 2) * 90;
        const style = {
          '--taste-confetti-x': `${Math.round(Math.cos(angle) * distance)}px`,
          '--taste-confetti-y': `${Math.round(Math.sin(angle) * distance * 0.8)}px`,
          '--taste-confetti-rot': `${Math.round(noise(i, 3) * 720 - 360)}deg`,
          '--taste-confetti-delay': `${Math.round(noise(i, 4) * 160)}ms`,
          background: COLORS[i % COLORS.length],
        } as CSSProperties;
        return <span key={i} className={`taste-confetti-piece${i % 3 === 0 ? ' taste-confetti-piece--round' : ''}`} style={style} />;
      })}
    </span>
  );
}
