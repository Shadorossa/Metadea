import { describe, it, expect } from 'vitest';
import {
  resolvePlayerKeyAction, isPlayerHandledKey, SEEK_STEP_SECONDS, SEEK_LARGE_STEP_SECONDS, VOLUME_STEP, SUB_DELAY_STEP_SECONDS,
} from './keymap';

describe('resolvePlayerKeyAction', () => {
  it('maps the documented shortcuts', () => {
    expect(resolvePlayerKeyAction({ key: ' ' })).toEqual({ type: 'toggle_pause' });
    expect(resolvePlayerKeyAction({ key: 'ArrowLeft' })).toEqual({ type: 'seek', seconds: -SEEK_STEP_SECONDS });
    expect(resolvePlayerKeyAction({ key: 'ArrowRight', shiftKey: true })).toEqual({ type: 'seek', seconds: SEEK_LARGE_STEP_SECONDS });
    expect(resolvePlayerKeyAction({ key: 'ArrowUp' })).toEqual({ type: 'volume', delta: VOLUME_STEP });
    expect(resolvePlayerKeyAction({ key: 'ArrowDown' })).toEqual({ type: 'volume', delta: -VOLUME_STEP });
    expect(resolvePlayerKeyAction({ key: 'm' })).toEqual({ type: 'toggle_mute' });
    expect(resolvePlayerKeyAction({ key: 'F' })).toEqual({ type: 'toggle_fullscreen' });
    expect(resolvePlayerKeyAction({ key: 'Escape' })).toEqual({ type: 'escape' });
    expect(resolvePlayerKeyAction({ key: 'n' })).toEqual({ type: 'next' });
    expect(resolvePlayerKeyAction({ key: 'P' })).toEqual({ type: 'prev' });
    expect(resolvePlayerKeyAction({ key: 'F12' })).toEqual({ type: 'screenshot' });
    expect(resolvePlayerKeyAction({ key: 'j' })).toEqual({ type: 'sub_delay', delta: -SUB_DELAY_STEP_SECONDS });
    expect(resolvePlayerKeyAction({ key: 'k' })).toEqual({ type: 'sub_delay', delta: SUB_DELAY_STEP_SECONDS });
    expect(resolvePlayerKeyAction({ key: 'q' })).toEqual({ type: 'toggle_queue' });
  });

  it('ignores chords with ctrl/alt/meta and unknown keys', () => {
    expect(resolvePlayerKeyAction({ key: 'f', ctrlKey: true })).toBeNull();
    expect(resolvePlayerKeyAction({ key: ' ', altKey: true })).toBeNull();
    expect(resolvePlayerKeyAction({ key: 'm', metaKey: true })).toBeNull();
    expect(resolvePlayerKeyAction({ key: 'x' })).toBeNull();
    expect(isPlayerHandledKey({ key: 'Tab' })).toBe(false);
    expect(isPlayerHandledKey({ key: 'ArrowLeft' })).toBe(true);
  });
});
