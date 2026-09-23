import { describe, it, expect } from 'vitest';
import { consumedUnits, consumedUnitsOf, consumptionMultiplier } from './consumption-units';

describe('consumedUnits', () => {
  it('counts a finished work once per run: first run + every counted re-run', () => {
    // 12-episode anime, rewatched twice → 36 episodes.
    expect(consumedUnits({ progress: 12, reconsumptionCount: 2 })).toBe(36);
    // Never re-consumed → exactly today's number.
    expect(consumedUnits({ progress: 12 })).toBe(12);
    expect(consumedUnits({ progress: 12, reconsumptionCount: 0, reconsuming: 0 })).toBe(12);
  });

  it('adds the partial progress of a re-run in progress on top of the full runs', () => {
    // Finished once, rewatched once, now 3 episodes into the third viewing.
    expect(consumedUnits({ progress: 3, totalUnits: 12, reconsumptionCount: 1, reconsuming: 1 })).toBe(27);
    expect(consumedUnits({ progress: 3, totalUnits: 12, reconsumptionCount: 0, reconsuming: true })).toBe(15);
    // Unknown total: the earlier runs can't be sized, only the new run counts.
    expect(consumedUnits({ progress: 3, totalUnits: null, reconsumptionCount: 1, reconsuming: 1 })).toBe(3);
  });

  it('never goes negative or multiplies garbage', () => {
    expect(consumedUnits({ progress: -5, reconsumptionCount: 3 })).toBe(0);
    expect(consumedUnits({ progress: 10, reconsumptionCount: -2 })).toBe(10);
    expect(consumedUnits({ progress: NaN, reconsumptionCount: 1 })).toBe(0);
  });

  it('row helpers read the snake_case fields and default to a single run', () => {
    expect(consumptionMultiplier({ reconsumption_count: 2 })).toBe(3);
    expect(consumptionMultiplier({})).toBe(1);
    expect(consumedUnitsOf({ reconsumption_count: 1, reconsuming: 0 }, 24)).toBe(48);
    expect(consumedUnitsOf({}, 24)).toBe(24);
  });
});
