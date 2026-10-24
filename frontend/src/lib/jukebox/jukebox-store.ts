// The jukebox's state and the pure queue decisions behind it (next / prev /
// shuffle / repeat). Module-level store so the mini player survives Astro
// page transitions; the media element and the side effects live in
// jukebox-engine.ts, the React strip in components/jukebox/.
import { createExternalStore, type ExternalStore } from '../shared/state/external-store';
import type { FavoriteTheme } from '../tauri/jukebox';

export type RepeatMode = 'off' | 'all' | 'one';
export type JukeboxStatus = 'idle' | 'loading' | 'playing' | 'paused';

export interface JukeboxState {
  // The favourites, in queue order.
  queue: FavoriteTheme[];
  // Index into `queue` of the loaded theme; null while nothing is loaded.
  index: number | null;
  status: JukeboxStatus;
  shuffle: boolean;
  // Play order while shuffling: a permutation of queue indices.
  shuffleOrder: number[];
  repeat: RepeatMode;
  // 0..1
  volume: number;
  // Seconds, current theme.
  time: number;
  duration: number;
  // The last load failed (no playable source, network error...).
  error: boolean;
  stripOpen: boolean;
  // A media-page theme overlay is up: the icon hides and playback pauses.
  overlayActive: boolean;
}

export const INITIAL_JUKEBOX_STATE: JukeboxState = {
  queue: [],
  index: null,
  status: 'idle',
  shuffle: false,
  shuffleOrder: [],
  repeat: 'off',
  volume: 0.8,
  time: 0,
  duration: 0,
  error: false,
  stripOpen: false,
  overlayActive: false,
};

// One store per window, like the audio element (jukebox-audio-host.ts): a
// second copy of this module (dev hot reload, another chunk URL) must see
// the queue and position of the one already playing, not an empty player.
const STORE_GLOBAL_KEY = '__metadeaJukeboxStore';
type StoreHost = { [STORE_GLOBAL_KEY]?: ExternalStore<JukeboxState> };
const storeHost = globalThis as unknown as StoreHost;

export const jukeboxStore: ExternalStore<JukeboxState> = typeof window === 'undefined'
  ? createExternalStore<JukeboxState>(INITIAL_JUKEBOX_STATE)
  : (storeHost[STORE_GLOBAL_KEY] ??= createExternalStore<JukeboxState>(INITIAL_JUKEBOX_STATE));

export type Rng = () => number;

export function themeKey(theme: { external_id: string; slug: string }): string {
  return `${theme.external_id}::${theme.slug}`;
}

export function findQueueIndex(queue: FavoriteTheme[], key: string | null): number | null {
  if (key === null) return null;
  const idx = queue.findIndex(f => themeKey(f.theme) === key);
  return idx === -1 ? null : idx;
}

// Fisher-Yates over 0..length-1, with `first` (the theme already playing)
// moved to the front so enabling shuffle never restarts the current song.
export function buildShuffleOrder(length: number, first: number | null, rng: Rng = Math.random): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (first !== null && first >= 0 && first < length) {
    const at = order.indexOf(first);
    if (at > 0) {
      order.splice(at, 1);
      order.unshift(first);
    }
  }
  return order;
}

function playOrder(state: JukeboxState): number[] {
  if (!state.shuffle) return state.queue.map((_, i) => i);
  // A stale order (queue changed underneath) falls back to natural order
  // rather than pointing at indices that no longer exist.
  const valid = state.shuffleOrder.length === state.queue.length
    && state.shuffleOrder.every(i => i >= 0 && i < state.queue.length);
  return valid ? state.shuffleOrder : state.queue.map((_, i) => i);
}

// Which queue index plays after the current one. `reason` is 'ended' when
// the track ran out (repeat rules apply) and 'manual' for the Next button,
// which always moves on: with repeat off, Next past the last theme wraps
// to the first while a natural end stops (null).
export function nextIndex(state: JukeboxState, reason: 'ended' | 'manual'): number | null {
  if (state.queue.length === 0) return null;
  if (state.index === null) return playOrder(state)[0] ?? null;
  if (reason === 'ended' && state.repeat === 'one') return state.index;
  const order = playOrder(state);
  const pos = order.indexOf(state.index);
  if (pos === -1) return order[0] ?? null;
  if (pos + 1 < order.length) return order[pos + 1];
  if (reason === 'manual' || state.repeat === 'all') return order[0];
  return null;
}

export type EndedStep = { type: 'stop' } | { type: 'replay' } | { type: 'play'; index: number };

// What a theme running out leads to: the next one, the same one again
// (repeat one, or repeat all over a single theme), or the end of the queue.
export function stepAfterEnded(state: JukeboxState): EndedStep {
  const target = nextIndex(state, 'ended');
  if (target === null) return { type: 'stop' };
  if (target === state.index) return { type: 'replay' };
  return { type: 'play', index: target };
}

export function prevIndex(state: JukeboxState): number | null {
  if (state.queue.length === 0) return null;
  const order = playOrder(state);
  if (state.index === null) return order[order.length - 1] ?? null;
  const pos = order.indexOf(state.index);
  if (pos === -1) return order[0] ?? null;
  return pos > 0 ? order[pos - 1] : order[order.length - 1];
}

export function cycleRepeat(mode: RepeatMode): RepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}

export function withShuffle(state: JukeboxState, shuffle: boolean, rng: Rng = Math.random): JukeboxState {
  return {
    ...state,
    shuffle,
    shuffleOrder: shuffle ? buildShuffleOrder(state.queue.length, state.index, rng) : [],
  };
}

// Points at a theme without playing it (the one saved last session). The
// shuffle order is rebuilt with it first, as when shuffle is switched on:
// otherwise it sits at a random spot in an order built before it was
// known, and the queue ends after whatever happened to follow it.
export function withCurrentIndex(state: JukeboxState, index: number, rng: Rng = Math.random): JukeboxState {
  return {
    ...state,
    index,
    status: 'paused',
    shuffleOrder: state.shuffle ? buildShuffleOrder(state.queue.length, index, rng) : state.shuffleOrder,
  };
}

// The queue changed (a star toggled, a reorder, a fresh load): keep pointing
// at the same theme wherever it moved, drop the pointer when it was
// unstarred, and rebuild the shuffle order for the new length.
export function withQueue(state: JukeboxState, queue: FavoriteTheme[], rng: Rng = Math.random): JukeboxState {
  const currentKey = state.index !== null && state.queue[state.index] ? themeKey(state.queue[state.index].theme) : null;
  const index = findQueueIndex(queue, currentKey);
  const lostCurrent = currentKey !== null && index === null;
  return {
    ...state,
    queue,
    index,
    status: lostCurrent ? 'idle' : state.status,
    time: lostCurrent ? 0 : state.time,
    duration: lostCurrent ? 0 : state.duration,
    error: lostCurrent ? false : state.error,
    shuffleOrder: state.shuffle ? buildShuffleOrder(queue.length, index, rng) : [],
  };
}

export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return INITIAL_JUKEBOX_STATE.volume;
  return Math.min(1, Math.max(0, volume));
}

export function currentTheme(state: JukeboxState): FavoriteTheme | null {
  return state.index === null ? null : state.queue[state.index] ?? null;
}

/** The element's real volume: the user's volume scaled by a temporary duck
 *  factor (Ambient mode plays the jukebox softly without touching the
 *  volume the user chose, which is what the strip shows and what is saved). */
export function effectiveVolume(volume: number, duck: number): number {
  const factor = Number.isFinite(duck) ? Math.min(1, Math.max(0, duck)) : 1;
  return clampVolume(volume) * factor;
}
