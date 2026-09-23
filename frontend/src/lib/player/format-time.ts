// Time formatting for the player UI (seek bar, hover tooltip, clock).

export function formatClock(seconds: number, forceHours = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 || forceHours ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// Both sides of "1:02 / 24:30" use the same width so the clock does not
// jump once the position crosses the hour mark.
export function formatClockPair(positionSecs: number, durationSecs: number): string {
  const hours = durationSecs >= 3600 || positionSecs >= 3600;
  return `${formatClock(positionSecs, hours)} / ${formatClock(durationSecs, hours)}`;
}

export function formatSignedSeconds(seconds: number): string {
  const rounded = Math.round(seconds * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(1)}s`;
}

export function formatSpeed(speed: number): string {
  return `${Number.isInteger(speed) ? speed.toFixed(0) : speed.toFixed(2).replace(/0+$/, '')}×`;
}
