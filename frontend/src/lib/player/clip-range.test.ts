import { describe, expect, it } from 'vitest';
import { clampClipRange, clipLength, initialClipRange, moveClipEnd, moveClipStart } from './clip-range';

describe('clampClipRange', () => {
  it('keeps selections between 3 and 10 seconds', () => {
    expect(clampClipRange(100, 105, 1400)).toEqual({ start: 100, end: 105 });
    expect(clampClipRange(100, 101, 1400)).toEqual({ start: 100, end: 103 });
    expect(clampClipRange(100, 130, 1400)).toEqual({ start: 100, end: 110 });
    expect(clampClipRange(100, 90, 1400)).toEqual({ start: 100, end: 103 });
    expect(clampClipRange(-4, 2, 1400)).toEqual({ start: 0, end: 3 });
    expect(clampClipRange(Number.NaN, Number.NaN, 100)).toEqual({ start: 0, end: 3 });
  });

  it('pulls the start back near the end of the file', () => {
    expect(clampClipRange(1398, 1403, 1400)).toEqual({ start: 1395, end: 1400 });
  });

  it('uses the whole file when it is shorter than the minimum', () => {
    expect(clampClipRange(0, 5, 2)).toEqual({ start: 0, end: 2 });
  });
});

describe('clip handles', () => {
  it('starts at the current time with five seconds', () => {
    expect(initialClipRange(42, 1400)).toEqual({ start: 42, end: 47 });
    expect(initialClipRange(1398, 1400)).toEqual({ start: 1395, end: 1400 });
  });

  it('moving the start keeps the end unless the rule needs it to move', () => {
    const range = { start: 100, end: 105 };
    expect(moveClipStart(range, 98, 1400)).toEqual({ start: 98, end: 105 });
    expect(moveClipStart(range, 104, 1400)).toEqual({ start: 104, end: 107 });
    expect(moveClipStart(range, 90, 1400)).toEqual({ start: 90, end: 100 });
  });

  it('moving the end keeps the start unless the rule needs it to move', () => {
    const range = { start: 100, end: 105 };
    expect(moveClipEnd(range, 109, 1400)).toEqual({ start: 100, end: 109 });
    expect(moveClipEnd(range, 101, 1400)).toEqual({ start: 98, end: 101 });
    expect(moveClipEnd(range, 120, 1400)).toEqual({ start: 110, end: 120 });
    expect(moveClipEnd(range, 2000, 1400)).toEqual({ start: 1390, end: 1400 });
  });

  it('measures the selection', () => {
    expect(clipLength({ start: 3, end: 9.5 })).toBe(6.5);
  });
});
