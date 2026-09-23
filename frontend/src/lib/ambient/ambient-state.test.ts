import { describe, it, expect, vi, afterEach } from 'vitest';
import { ambientActiveStore, enterAmbient, exitAmbient, interceptAmbientInput, isWithinExitGesture, onAmbientActivity } from './ambient-state';
import { collectAmbientBlockers, type AmbientBlockerSnapshot } from './ambient-blockers';
import { formatAmbientClock, msUntilNextMinute } from './ambient-clock';
import { parseAmbientIdleMinutes } from '../storage/preferences';

afterEach(() => ambientActiveStore.set(false));

describe('interceptAmbientInput', () => {
  it('reports activity while the screensaver is down', () => {
    const listener = vi.fn();
    const off = onAmbientActivity(listener);
    expect(interceptAmbientInput(10_000)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('closes the screensaver and swallows the input, and the rest of that gesture', () => {
    const listener = vi.fn();
    const off = onAmbientActivity(listener);
    enterAmbient();
    expect(interceptAmbientInput(20_000)).toBe(true);
    expect(ambientActiveStore.get()).toBe(false);
    expect(interceptAmbientInput(20_100)).toBe(true);
    expect(isWithinExitGesture(20_100)).toBe(true);
    expect(interceptAmbientInput(21_000)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('exitAmbient is a no-op when not active', () => {
    exitAmbient(50_000);
    expect(isWithinExitGesture(50_001)).toBe(false);
  });
});

describe('collectAmbientBlockers', () => {
  const idle: AmbientBlockerSnapshot = {
    playerModalOpen: false, playbackPlaying: false, readerOpen: false, gameRunning: false,
    modalTextInputFocused: false, foreignMediaPlaying: false, themeOverlayOpen: false,
  };

  it('is empty when nothing is going on', () => {
    expect(collectAmbientBlockers(idle)).toEqual([]);
  });

  it('names every blocker', () => {
    expect(collectAmbientBlockers({ ...idle, playerModalOpen: true })).toEqual(['player']);
    expect(collectAmbientBlockers({ ...idle, playbackPlaying: true })).toEqual(['player']);
    expect(collectAmbientBlockers({ ...idle, readerOpen: true })).toEqual(['reader']);
    expect(collectAmbientBlockers({ ...idle, gameRunning: true })).toEqual(['game']);
    expect(collectAmbientBlockers({ ...idle, modalTextInputFocused: true })).toEqual(['text-input']);
    expect(collectAmbientBlockers({ ...idle, foreignMediaPlaying: true })).toEqual(['media-audio']);
    expect(collectAmbientBlockers({ ...idle, themeOverlayOpen: true })).toEqual(['media-audio']);
  });
});

describe('ambient clock', () => {
  it('sleeps until the next minute', () => {
    expect(msUntilNextMinute(new Date(2026, 0, 1, 10, 0, 59, 500))).toBe(500);
    expect(msUntilNextMinute(new Date(2026, 0, 1, 10, 0, 0, 0))).toBe(60_000);
  });

  it('formats without seconds in the given locale', () => {
    const { time, date } = formatAmbientClock(new Date(2026, 8, 23, 21, 5, 42), 'en');
    expect(time).toMatch(/9:05/);
    expect(time).not.toMatch(/42/);
    expect(date).toMatch(/September/);
    expect(formatAmbientClock(new Date(2026, 8, 23, 21, 5), 'es').date).toMatch(/septiembre/);
  });
});

describe('parseAmbientIdleMinutes', () => {
  it('accepts the offered options and defaults to 2', () => {
    expect(parseAmbientIdleMinutes('5')).toBe(5);
    expect(parseAmbientIdleMinutes('10')).toBe(10);
    expect(parseAmbientIdleMinutes(null)).toBe(2);
    expect(parseAmbientIdleMinutes('3')).toBe(2);
    expect(parseAmbientIdleMinutes('abc')).toBe(2);
  });
});
