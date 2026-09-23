import { describe, it, expect } from 'vitest';
import { formatPresenceLines } from './presence-sync';

describe('formatPresenceLines', () => {
  it('shows the series in details and the episode label + title in state', () => {
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 2, episodeLabel: 'S01E02', episodeTitle: 'The School of the Grassland', status: 'playing' }))
      .toEqual({ details: 'Watching Show', state: 'S01E02 - The School of the Grassland' });
  });

  it('falls back to a zero-padded E<NN> when no label is known', () => {
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 2, status: 'playing' }).state).toBe('E02');
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 12, episodeTitle: 'Finale', status: 'playing' }).state).toBe('E12 - Finale');
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 3, episodeLabel: '  ', status: 'playing' }).state).toBe('E03');
  });

  it('keeps movies to their M label', () => {
    expect(formatPresenceLines({ title: 'Film', episodeNumber: 1, episodeLabel: 'M01', episodeTitle: 'Film', status: 'playing' }).state).toBe('M01');
  });

  it('appends Paused while paused', () => {
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 2, episodeLabel: 'S01E02', episodeTitle: 'Pilot', status: 'paused' }).state)
      .toBe('S01E02 - Pilot · Paused');
    expect(formatPresenceLines({ title: 'Show', episodeNumber: 2, status: 'paused' }).state).toBe('E02 · Paused');
  });
});
