import { describe, it, expect } from 'vitest';
import { formatSessionTime, pathAfterQuit, pauseMenuActions } from './pause-menu';

describe('pause menu', () => {
  it('offers Save state only when RetroArch accepts network commands', () => {
    expect(pauseMenuActions({ canSaveState: false })).toEqual(['continue', 'quit']);
    expect(pauseMenuActions({ canSaveState: true })).toEqual(['continue', 'save_state', 'quit']);
  });

  it('formats the session time', () => {
    expect(formatSessionTime(0)).toBe('0m');
    expect(formatSessionTime(59)).toBe('0m');
    expect(formatSessionTime(12 * 60 + 5)).toBe('12m');
    expect(formatSessionTime(65 * 60)).toBe('1h 05m');
  });

  it('returns to Big Picture, else to the game page', () => {
    expect(pathAfterQuit('game:1234', true, '/local')).toBeNull();
    expect(pathAfterQuit('game:1234', false, '/local')).toBe('/media?id=game%3A1234');
    expect(pathAfterQuit('game:1234', false, '/media?id=game%3A1234')).toBeNull();
    expect(pathAfterQuit('rom_00ff', false, '/settings')).toBe('/local');
    expect(pathAfterQuit('', false, '/local?x=1')).toBeNull();
  });
});
