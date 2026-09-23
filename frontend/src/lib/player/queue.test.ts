import { describe, it, expect } from 'vitest';
import {
  fileBasename, isSameFile, findQueueIndexByPath, nextQueueIndex, prevQueueIndex, clampQueueIndex, queueEntryHeading,
} from './queue';

describe('fileBasename / isSameFile', () => {
  it('strips both separator styles', () => {
    expect(fileBasename('C:\\Series\\Ep 01.mkv')).toBe('Ep 01.mkv');
    expect(fileBasename('/mnt/series/Ep 01.mkv')).toBe('Ep 01.mkv');
    expect(fileBasename('plain.mkv')).toBe('plain.mkv');
  });

  it('compares basenames case-insensitively and rejects empties', () => {
    expect(isSameFile('C:\\a\\EP01.MKV', '/b/ep01.mkv')).toBe(true);
    expect(isSameFile('a.mkv', 'b.mkv')).toBe(false);
    expect(isSameFile(null, 'b.mkv')).toBe(false);
    expect(isSameFile('a.mkv', '')).toBe(false);
  });
});

describe('findQueueIndexByPath', () => {
  const queue = ['C:\\S\\e1.mkv', 'C:\\S\\e2.mkv', 'C:\\S\\e3.mkv'];

  it('finds the entry whose basename matches', () => {
    expect(findQueueIndexByPath(queue, '/other/E2.mkv')).toBe(1);
  });

  it('returns -1 for unknown or empty paths', () => {
    expect(findQueueIndexByPath(queue, 'nope.mkv')).toBe(-1);
    expect(findQueueIndexByPath(queue, null)).toBe(-1);
  });
});

describe('next/prev/clamp', () => {
  it('walks within bounds and returns null at the edges', () => {
    expect(nextQueueIndex(0, 3)).toBe(1);
    expect(nextQueueIndex(2, 3)).toBeNull();
    expect(prevQueueIndex(1, 3)).toBe(0);
    expect(prevQueueIndex(0, 3)).toBeNull();
    expect(nextQueueIndex(0, 0)).toBeNull();
  });

  it('clamps out-of-range and non-finite indices', () => {
    expect(clampQueueIndex(-4, 3)).toBe(0);
    expect(clampQueueIndex(9, 3)).toBe(2);
    expect(clampQueueIndex(1.7, 3)).toBe(1);
    expect(clampQueueIndex(Number.NaN, 3)).toBe(0);
    expect(clampQueueIndex(5, 0)).toBe(0);
  });
});

describe('queueEntryHeading', () => {
  it('prefers the episode title, then the label, then the work alone', () => {
    expect(queueEntryHeading('Show', 0, ['Pilot'], ['S01E01'])).toBe('Show · Pilot');
    expect(queueEntryHeading('Show', 1, ['Pilot', '  '], ['S01E01', 'S01E02'])).toBe('Show · S01E02');
    expect(queueEntryHeading('Show', 5, [], [])).toBe('Show');
  });
});
