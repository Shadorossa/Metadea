import { describe, it, expect } from 'vitest';
import {
  UI_SCALE_MIN,
  UI_SCALE_PRESETS,
  UI_SCALE_REFERENCE_WIDTH,
  computeUiScale,
  parseAppliedZoom,
  parseUiScalePreference,
  serializeUiScalePreference,
  shouldApplyUiScale,
  toPhysicalRect,
} from './ui-scale';

describe('parseUiScalePreference', () => {
  it('reads every preset back', () => {
    for (const preset of UI_SCALE_PRESETS) {
      expect(parseUiScalePreference(serializeUiScalePreference(preset))).toBe(preset);
    }
    expect(parseUiScalePreference(serializeUiScalePreference('auto'))).toBe('auto');
  });

  it.each([null, undefined, '', 'auto', '95', '0', 'abc', '1.25'])('treats %j as Auto', raw => {
    expect(parseUiScalePreference(raw)).toBe('auto');
  });
});

describe('computeUiScale', () => {
  it('is 1 at the reference width and never upscales in Auto', () => {
    expect(computeUiScale('auto', UI_SCALE_REFERENCE_WIDTH)).toBe(1);
    expect(computeUiScale('auto', 2560)).toBe(1);
    expect(computeUiScale('auto', 3840)).toBe(1);
  });

  it('shrinks proportionally below the reference width', () => {
    expect(computeUiScale('auto', 1600)).toBeCloseTo(1600 / 1920, 3);
    expect(computeUiScale('auto', 1366)).toBeCloseTo(0.711, 3);
    // 1920×1080 at 125 % Windows scaling.
    expect(computeUiScale('auto', 1536)).toBe(0.8);
    expect(computeUiScale('auto', 1280)).toBe(UI_SCALE_MIN);
  });

  it('clamps to the minimum so an 800 px window stays readable', () => {
    expect(computeUiScale('auto', 800)).toBe(UI_SCALE_MIN);
    expect(computeUiScale('auto', 1)).toBe(UI_SCALE_MIN);
  });

  it('falls back to 1 for an unusable width', () => {
    expect(computeUiScale('auto', 0)).toBe(1);
    expect(computeUiScale('auto', Number.NaN)).toBe(1);
  });

  it('uses a fixed preset whatever the width', () => {
    expect(computeUiScale(80, 3840)).toBe(0.8);
    expect(computeUiScale(125, 800)).toBe(1.25);
    expect(computeUiScale(100, 1280)).toBe(1);
  });
});

describe('shouldApplyUiScale', () => {
  it('ignores innerWidth rounding noise and applies real changes', () => {
    expect(shouldApplyUiScale(0.711, 0.7115)).toBe(false);
    expect(shouldApplyUiScale(1, 1)).toBe(false);
    expect(shouldApplyUiScale(1, 0.8)).toBe(true);
    expect(shouldApplyUiScale(0.8, 1.25)).toBe(true);
  });
});

describe('parseAppliedZoom', () => {
  it('defaults to 1 (a fresh webview) and reads a recorded zoom', () => {
    expect(parseAppliedZoom(null)).toBe(1);
    expect(parseAppliedZoom('garbage')).toBe(1);
    expect(parseAppliedZoom('0')).toBe(1);
    expect(parseAppliedZoom('0.711')).toBe(0.711);
  });
});

describe('toPhysicalRect', () => {
  it('is the identity at DPR 1', () => {
    expect(toPhysicalRect({ x: 10, y: 20, width: 300, height: 200 }, 1))
      .toEqual({ x: 10, y: 20, width: 300, height: 200 });
  });

  it('scales by the monitor scale times the interface zoom', () => {
    // 150 % Windows scaling with an 80 % interface scale: DPR 1.2.
    expect(toPhysicalRect({ x: 100, y: 50, width: 1000, height: 562.5 }, 1.5 * 0.8))
      .toEqual({ x: 120, y: 60, width: 1200, height: 675 });
  });

  it('rounds the edges so adjacent rects never leave a gap', () => {
    const rect = toPhysicalRect({ x: 0.4, y: 0.4, width: 10.3, height: 10.3 }, 1.25);
    expect(rect.x + rect.width).toBe(Math.round(10.7 * 1.25));
    expect(rect.y + rect.height).toBe(Math.round(10.7 * 1.25));
  });

  it('treats a missing DPR as 1', () => {
    expect(toPhysicalRect({ x: 1, y: 2, width: 3, height: 4 }, 0)).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});
