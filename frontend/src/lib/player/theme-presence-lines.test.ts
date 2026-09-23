import { describe, it, expect } from 'vitest';
import { formatThemePresenceLines } from './presence-sync';

describe('formatThemePresenceLines', () => {
  it('uses the song title with artists and media title', () => {
    expect(formatThemePresenceLines({
      themeLabel: 'OP1', songTitle: 'Colors', artists: 'FLOW', mediaTitle: 'Code Geass', status: 'playing',
    })).toEqual({ details: 'Listening Colors', state: 'FLOW · Code Geass' });
  });

  it('falls back to the OP/ED label and omits missing artists', () => {
    expect(formatThemePresenceLines({
      themeLabel: 'ED2', songTitle: null, artists: null, mediaTitle: 'Code Geass', status: 'playing',
    })).toEqual({ details: 'Listening ED2', state: 'Code Geass' });
  });

  it('appends Paused while paused', () => {
    expect(formatThemePresenceLines({
      themeLabel: 'OP1', songTitle: ' Colors ', artists: 'FLOW', mediaTitle: 'Code Geass', status: 'paused',
    }).state).toBe('FLOW · Code Geass · Paused');
  });
});
