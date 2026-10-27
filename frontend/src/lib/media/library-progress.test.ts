import { describe, expect, it } from 'vitest';
import { nextProgress } from './library-progress';

describe('nextProgress', () => {
  it.each([
    [{ progress: 10, reconsuming: 0 }, 3, 10],
    [{ progress: 10, reconsuming: 0 }, 11, 11],
    [{ progress: 0 }, 1, 1],
    // A re-run counts from 1 again.
    [{ progress: 12, reconsuming: 1 }, 3, 3],
  ])('%j + %i → %i', (entry, n, expected) => {
    expect(nextProgress({ progress_2: 0, ...entry }, n)).toBe(expected);
  });

  it('applies the same rule to volumes', () => {
    expect(nextProgress({ progress: 0, progress_2: 7, reconsuming: 0 }, 2, 'progress_2')).toBe(7);
  });
});
