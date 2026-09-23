import { describe, it, expect } from 'vitest';
import {
  AUTO_MARK_THRESHOLD, positionFraction, hasReachedWatchedThreshold, shouldPersistResumePosition, indicesToMarkOnAdvance,
} from './progress-rules';

describe('positionFraction', () => {
  it('is 0 without a usable length and clamps to [0, 1]', () => {
    expect(positionFraction(10, 0)).toBe(0);
    expect(positionFraction(10, Number.NaN)).toBe(0);
    expect(positionFraction(-5, 100)).toBe(0);
    expect(positionFraction(150, 100)).toBe(1);
    expect(positionFraction(25, 100)).toBe(0.25);
  });
});

describe('watched threshold', () => {
  it('flips exactly at 80 %', () => {
    expect(AUTO_MARK_THRESHOLD).toBe(0.8);
    expect(hasReachedWatchedThreshold(79.9, 100)).toBe(false);
    expect(hasReachedWatchedThreshold(80, 100)).toBe(true);
    expect(hasReachedWatchedThreshold(10, 0)).toBe(false);
  });

  it('stops persisting the resume point once the threshold is reached', () => {
    expect(shouldPersistResumePosition(50, 100)).toBe(true);
    expect(shouldPersistResumePosition(80, 100)).toBe(false);
    // Unknown length: still worth keeping the position.
    expect(shouldPersistResumePosition(50, 0)).toBe(true);
  });
});

describe('indicesToMarkOnAdvance', () => {
  it('marks the finished episode and everything skipped over', () => {
    expect(indicesToMarkOnAdvance(0, 1, true)).toEqual([0]);
    expect(indicesToMarkOnAdvance(0, 3, true)).toEqual([0, 1, 2]);
  });

  it('skips the current episode when it was not really watched', () => {
    expect(indicesToMarkOnAdvance(0, 1, false)).toEqual([]);
    expect(indicesToMarkOnAdvance(0, 3, false)).toEqual([1, 2]);
  });

  it('never marks on a backwards or same-index move', () => {
    expect(indicesToMarkOnAdvance(2, 1, true)).toEqual([]);
    expect(indicesToMarkOnAdvance(2, 2, true)).toEqual([]);
  });
});
