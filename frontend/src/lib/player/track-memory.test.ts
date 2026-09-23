import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetTrackMemory, getTrackMemory, markManualCycle, pruneMemory, rememberTrack, takeManualCycle,
} from './track-memory';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: key => data.get(key) ?? null,
    key: index => [...data.keys()][index] ?? null,
    removeItem: key => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe('track memory', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('remembers audio and subtitle choices per series, including "off"', () => {
    rememberTrack('anime:1', 'audio', { lang: 'ja', title: null, forced: false });
    rememberTrack('anime:1', 'sub', null);
    expect(getTrackMemory('anime:1')).toEqual({ audio: { lang: 'ja', title: null, forced: false }, sub: null });
    expect(getTrackMemory('anime:2')).toBeNull();
    expect(getTrackMemory(null)).toBeNull();
  });

  it('forgets a series on reset', () => {
    rememberTrack('series:9', 'sub', { lang: 'es', title: 'Castellano', forced: false });
    forgetTrackMemory('series:9');
    expect(getTrackMemory('series:9')).toBeNull();
  });

  it('keeps only the newest entries', () => {
    const memory = { a: { updatedAt: 1 }, b: { updatedAt: 3 }, c: { updatedAt: 2 } };
    expect(Object.keys(pruneMemory(memory, 2)).sort()).toEqual(['b', 'c']);
  });

  it('reports a keyboard cycle exactly once', () => {
    markManualCycle('sub');
    expect(takeManualCycle('audio')).toBe(false);
    expect(takeManualCycle('sub')).toBe(true);
    expect(takeManualCycle('sub')).toBe(false);
  });
});
