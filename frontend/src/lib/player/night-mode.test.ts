import { describe, expect, it } from 'vitest';
import { isNightModeActive, nightModeStore, parseNightMode, serializeNightMode, setNightModeEnabled, toggleNightMode } from './night-mode';

describe('night mode preference', () => {
  it('defaults to off and round-trips', () => {
    expect(parseNightMode(null)).toBe(false);
    expect(parseNightMode('garbage')).toBe(false);
    expect(parseNightMode(serializeNightMode(true))).toBe(true);
    expect(parseNightMode(serializeNightMode(false))).toBe(false);
  });

  it('toggles the shared store even without localStorage', () => {
    setNightModeEnabled(false);
    toggleNightMode();
    expect(nightModeStore.get()).toBe(true);
    toggleNightMode();
    expect(nightModeStore.get()).toBe(false);
  });

  it('counts only an applied chain as active', () => {
    expect(isNightModeActive('full')).toBe(true);
    expect(isNightModeActive('basic')).toBe(true);
    for (const level of ['off', 'pending', 'unavailable'] as const) expect(isNightModeActive(level)).toBe(false);
  });
});
