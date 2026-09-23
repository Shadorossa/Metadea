import { describe, it, expect } from 'vitest';
import type { FavoriteTheme } from '../tauri/jukebox';
import {
  INITIAL_JUKEBOX_STATE, type JukeboxState,
  buildShuffleOrder, clampVolume, currentTheme, effectiveVolume, cycleRepeat, findQueueIndex, nextIndex, prevIndex, themeKey,
  withQueue, withShuffle,
} from './jukebox-store';

function fav(externalId: string, slug: string): FavoriteTheme {
  return {
    theme: { external_id: externalId, slug, theme_type: 'OP', sequence: 1, song_title: slug, artists: null, episodes: null, video_url: null },
    media_title: externalId,
    cover_url: null,
    preview_frame_path: null,
  };
}

const queue = [fav('a', 'OP1'), fav('a', 'ED1'), fav('b', 'OP1'), fav('c', 'OP2')];

function state(patch: Partial<JukeboxState> = {}): JukeboxState {
  return { ...INITIAL_JUKEBOX_STATE, queue, index: 0, ...patch };
}

// Deterministic rng: always 0 → Fisher-Yates yields a fixed rotation.
const zeroRng = () => 0;

describe('themeKey / findQueueIndex', () => {
  it('keys on external id and slug so OP1 of two works never collide', () => {
    expect(themeKey(queue[0].theme)).toBe('a::OP1');
    expect(themeKey(queue[2].theme)).toBe('b::OP1');
    expect(findQueueIndex(queue, 'b::OP1')).toBe(2);
    expect(findQueueIndex(queue, 'zzz')).toBeNull();
    expect(findQueueIndex(queue, null)).toBeNull();
  });
});

describe('nextIndex', () => {
  it('walks the queue in order and stops at the end when repeat is off', () => {
    expect(nextIndex(state({ index: 0 }), 'ended')).toBe(1);
    expect(nextIndex(state({ index: 2 }), 'ended')).toBe(3);
    expect(nextIndex(state({ index: 3 }), 'ended')).toBeNull();
  });

  it('manual next wraps to the first theme even with repeat off', () => {
    expect(nextIndex(state({ index: 3 }), 'manual')).toBe(0);
  });

  it('repeat all wraps, repeat one replays on end but moves on manually', () => {
    expect(nextIndex(state({ index: 3, repeat: 'all' }), 'ended')).toBe(0);
    expect(nextIndex(state({ index: 1, repeat: 'one' }), 'ended')).toBe(1);
    expect(nextIndex(state({ index: 1, repeat: 'one' }), 'manual')).toBe(2);
  });

  it('starts from the first of the play order when nothing is loaded', () => {
    expect(nextIndex(state({ index: null }), 'manual')).toBe(0);
    expect(nextIndex(state({ index: null, shuffle: true, shuffleOrder: [2, 0, 3, 1] }), 'manual')).toBe(2);
  });

  it('returns null on an empty queue', () => {
    expect(nextIndex(state({ queue: [], index: null }), 'manual')).toBeNull();
    expect(prevIndex(state({ queue: [], index: null }))).toBeNull();
  });

  it('follows the shuffle order and ignores a stale one', () => {
    const shuffled = state({ index: 3, shuffle: true, shuffleOrder: [3, 1, 0, 2] });
    expect(nextIndex(shuffled, 'ended')).toBe(1);
    expect(nextIndex({ ...shuffled, index: 2 }, 'ended')).toBeNull();
    expect(nextIndex({ ...shuffled, index: 2, repeat: 'all' }, 'ended')).toBe(3);
    // Order for a different queue length: natural order applies instead.
    expect(nextIndex(state({ index: 0, shuffle: true, shuffleOrder: [1, 0] }), 'ended')).toBe(1);
  });

  it('recovers when the current index is not in the order', () => {
    expect(nextIndex(state({ index: 9 }), 'ended')).toBe(0);
    expect(prevIndex(state({ index: 9 }))).toBe(0);
  });
});

describe('prevIndex', () => {
  it('goes back one and wraps from the first to the last', () => {
    expect(prevIndex(state({ index: 2 }))).toBe(1);
    expect(prevIndex(state({ index: 0 }))).toBe(3);
    expect(prevIndex(state({ index: null }))).toBe(3);
  });

  it('walks the shuffle order backwards', () => {
    const shuffled = state({ index: 1, shuffle: true, shuffleOrder: [3, 1, 0, 2] });
    expect(prevIndex(shuffled)).toBe(3);
    expect(prevIndex({ ...shuffled, index: 3 })).toBe(2);
  });
});

describe('buildShuffleOrder / withShuffle', () => {
  it('is a permutation with the current theme first', () => {
    const order = buildShuffleOrder(4, 2, zeroRng);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
    expect(order[0]).toBe(2);
    expect(buildShuffleOrder(0, null, zeroRng)).toEqual([]);
    expect([...buildShuffleOrder(5, null, zeroRng)].sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('withShuffle builds the order on and clears it off, without moving the pointer', () => {
    const on = withShuffle(state({ index: 1 }), true, zeroRng);
    expect(on.shuffle).toBe(true);
    expect(on.index).toBe(1);
    expect(on.shuffleOrder[0]).toBe(1);
    expect(on.shuffleOrder).toHaveLength(4);
    const off = withShuffle(on, false);
    expect(off.shuffle).toBe(false);
    expect(off.shuffleOrder).toEqual([]);
  });
});

describe('withQueue', () => {
  it('follows the current theme to its new position after a reorder', () => {
    const reordered = [queue[2], queue[0], queue[3], queue[1]];
    const next = withQueue(state({ index: 3, status: 'playing', time: 12 }), reordered);
    expect(next.index).toBe(2);
    expect(next.status).toBe('playing');
    expect(next.time).toBe(12);
  });

  it('drops the pointer and resets playback when the current theme was unstarred', () => {
    const next = withQueue(state({ index: 1, status: 'playing', time: 30, duration: 90, error: true }), [queue[0], queue[2]]);
    expect(next.index).toBeNull();
    expect(next.status).toBe('idle');
    expect(next.time).toBe(0);
    expect(next.duration).toBe(0);
    expect(next.error).toBe(false);
    expect(currentTheme(next)).toBeNull();
  });

  it('rebuilds the shuffle order for the new length', () => {
    const next = withQueue(state({ index: 0, shuffle: true, shuffleOrder: [0, 3, 1, 2] }), [queue[0], queue[1]], zeroRng);
    expect(next.shuffleOrder).toHaveLength(2);
    expect(next.shuffleOrder[0]).toBe(0);
    expect(withQueue(state({ index: null }), [], zeroRng).index).toBeNull();
  });
});

describe('cycleRepeat / clampVolume / currentTheme', () => {
  it('cycles off → all → one → off', () => {
    expect(cycleRepeat('off')).toBe('all');
    expect(cycleRepeat('all')).toBe('one');
    expect(cycleRepeat('one')).toBe('off');
  });

  it('clamps the volume into 0..1 and rejects NaN', () => {
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(-2)).toBe(0);
    expect(clampVolume(0.3)).toBe(0.3);
    expect(clampVolume(Number.NaN)).toBe(INITIAL_JUKEBOX_STATE.volume);
  });

  it('currentTheme reads the loaded entry', () => {
    expect(currentTheme(state({ index: 2 }))).toBe(queue[2]);
    expect(currentTheme(state({ index: 7 }))).toBeNull();
  });
});

describe('effectiveVolume', () => {
  it('scales the user volume by the duck factor, clamped', () => {
    expect(effectiveVolume(0.8, 1)).toBeCloseTo(0.8);
    expect(effectiveVolume(0.8, 0.35)).toBeCloseTo(0.28);
    expect(effectiveVolume(0.8, 0)).toBe(0);
    expect(effectiveVolume(0.8, 2)).toBeCloseTo(0.8);
    expect(effectiveVolume(0.8, Number.NaN)).toBeCloseTo(0.8);
    expect(effectiveVolume(1.5, 0.5)).toBeCloseTo(0.5);
  });
});
