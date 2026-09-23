import { describe, expect, it } from 'vitest';
import { isFillerEpisode } from '../anime/filler';
import { fillerInfoFromEpisodes, nextCanonInQueue, shouldShowFillerCard } from './filler-next';

describe('fillerInfoFromEpisodes', () => {
  it('marks exactly the given episodes as filler', () => {
    const info = fillerInfoFromEpisodes('anime:1', [5, 3, 3, 0, 2.5]);
    expect(isFillerEpisode(info, 3)).toBe(true);
    expect(isFillerEpisode(info, 5)).toBe(true);
    expect(isFillerEpisode(info, 4)).toBe(false);
    expect(info.fillerAbsolute).toEqual([3, 5]);
  });
});

describe('nextCanonInQueue', () => {
  const queue = [218, 219, 220, 221, 222, 223];

  it('offers the next canon episode past a filler run in the queue', () => {
    expect(nextCanonInQueue('anime:1', queue, [220, 221, 222], 1)).toEqual({ episode: 223, skipped: 3, queueIndex: 5 });
  });

  it('stays quiet when the next episode is canon', () => {
    expect(nextCanonInQueue('anime:1', queue, [221], 0)).toBeNull();
  });

  it('stays quiet when the canon episode is not queued or data is missing', () => {
    expect(nextCanonInQueue('anime:1', queue, [220, 221, 222, 223], 1)).toBeNull();
    expect(nextCanonInQueue('anime:1', queue, [], 1)).toBeNull();
    expect(nextCanonInQueue(null, queue, [220], 1)).toBeNull();
    expect(nextCanonInQueue('anime:1', queue, [220], 9)).toBeNull();
  });
});

describe('shouldShowFillerCard', () => {
  it('shows during the last 45 s or the ending segment', () => {
    expect(shouldShowFillerCard(1400, 1440, false)).toBe(true);
    expect(shouldShowFillerCard(1300, 1440, false)).toBe(false);
    expect(shouldShowFillerCard(1300, 1440, true)).toBe(true);
    expect(shouldShowFillerCard(0, 0, true)).toBe(false);
  });
});
