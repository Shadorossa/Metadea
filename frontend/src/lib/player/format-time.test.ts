import { describe, it, expect } from 'vitest';
import { formatClock, formatClockPair, formatSignedSeconds, formatSpeed } from './format-time';
import { formatCaptureTimecode, isPlayerError, playerErrorCode } from './player-status';
import { parseControlsMode } from './player-settings';

describe('formatClock', () => {
  it('formats minutes and hours', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3661)).toBe('1:01:01');
    expect(formatClock(65, true)).toBe('0:01:05');
    expect(formatClock(-3)).toBe('0:00');
    expect(formatClock(Number.NaN)).toBe('0:00');
  });

  it('keeps both sides of the pair at the same width', () => {
    expect(formatClockPair(65, 4000)).toBe('0:01:05 / 1:06:40');
    expect(formatClockPair(65, 600)).toBe('1:05 / 10:00');
  });
});

describe('small formatters', () => {
  it('formats signed subtitle delays and speeds', () => {
    expect(formatSignedSeconds(0.1)).toBe('+0.1s');
    // Math.round rounds half towards +∞ (-0.25 -> -0.2), so use a clear case.
    expect(formatSignedSeconds(-0.26)).toBe('-0.3s');
    expect(formatSignedSeconds(0)).toBe('0.0s');
    expect(formatSpeed(1)).toBe('1×');
    expect(formatSpeed(0.5)).toBe('0.5×');
    expect(formatSpeed(0.75)).toBe('0.75×');
  });

  it('turns capture timecodes into clock text', () => {
    expect(formatCaptureTimecode('01h02m03s456')).toBe('1:02:03.456');
    expect(formatCaptureTimecode('weird')).toBe('weird');
  });

  it('recognises player error payloads', () => {
    expect(isPlayerError({ code: 'engine_unavailable', detail: '' })).toBe(true);
    expect(isPlayerError('boom')).toBe(false);
    expect(playerErrorCode({ code: 'mpv_error', detail: 'x' })).toBe('mpv_error');
    expect(playerErrorCode(new Error('x'))).toBe('unknown');
  });

  it('parses the controls mode setting with a safe default', () => {
    expect(parseControlsMode('docked')).toBe('docked');
    expect(parseControlsMode(undefined)).toBe('overlay');
  });
});
