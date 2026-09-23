// Tiny generated navigation blips for Big Picture (no audio assets): one
// short sine/triangle envelope per event through a shared AudioContext,
// created lazily on the first sound so nothing starts while sounds are off.

export type NavSound = 'move' | 'confirm' | 'back' | 'tab' | 'error';

const TONES: Record<NavSound, { freq: number; to: number; ms: number; type: OscillatorType }> = {
  move: { freq: 660, to: 700, ms: 40, type: 'sine' },
  tab: { freq: 520, to: 620, ms: 60, type: 'triangle' },
  confirm: { freq: 700, to: 1050, ms: 90, type: 'triangle' },
  back: { freq: 520, to: 360, ms: 80, type: 'triangle' },
  error: { freq: 220, to: 180, ms: 120, type: 'square' },
};

const PEAK_GAIN = 0.05;

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (context) return context;
  try {
    const Ctor = typeof window === 'undefined' ? undefined : window.AudioContext;
    context = Ctor ? new Ctor() : null;
  } catch {
    context = null;
  }
  return context;
}

/** Plays `sound` at `volume` (0–1 on top of the fixed, quiet peak). */
export function playNavSound(sound: NavSound, volume = 1): void {
  const ctx = audioContext();
  if (!ctx || volume <= 0) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const tone = TONES[sound];
  const now = ctx.currentTime;
  const end = now + tone.ms / 1000;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = tone.type;
  osc.frequency.setValueAtTime(tone.freq, now);
  osc.frequency.linearRampToValueAtTime(tone.to, end);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN * Math.min(1, volume), now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(end + 0.02);
}
