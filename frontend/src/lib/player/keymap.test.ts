import { describe, it, expect } from 'vitest';
import {
  resolvePlayerKeyAction, isPlayerHandledKey, SEEK_STEP_SECONDS, SEEK_LARGE_STEP_SECONDS, VOLUME_STEP, SUB_DELAY_STEP_SECONDS,
  PLAYER_KEY_BINDINGS, SPEED_STEP, clampSpeed, CLIP_KEY_BINDINGS, clipKeyConflicts, bindingAction,
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
    expect(resolvePlayerKeyAction({ key: 's' })).toEqual({ type: 'skip_segment' });
    expect(resolvePlayerKeyAction({ key: 'S' })).toEqual({ type: 'skip_segment' });
  });

  it('ignores chords with ctrl/alt/meta and unknown keys', () => {
    expect(resolvePlayerKeyAction({ key: 'f', ctrlKey: true })).toBeNull();
    expect(resolvePlayerKeyAction({ key: ' ', altKey: true })).toBeNull();
    expect(resolvePlayerKeyAction({ key: 'm', metaKey: true })).toBeNull();
    expect(resolvePlayerKeyAction({ key: 'x' })).toBeNull();
    expect(isPlayerHandledKey({ key: 'Tab' })).toBe(false);
    expect(isPlayerHandledKey({ key: 'ArrowLeft' })).toBe(true);
  });

  it('maps the phase-2 additions', () => {
    expect(resolvePlayerKeyAction({ key: 'ArrowLeft', ctrlKey: true })).toEqual({ type: 'prev' });
    expect(resolvePlayerKeyAction({ key: 'ArrowRight', ctrlKey: true })).toEqual({ type: 'next' });
    expect(resolvePlayerKeyAction({ key: ',' })).toEqual({ type: 'frame_step', direction: 'back' });
    expect(resolvePlayerKeyAction({ key: '.' })).toEqual({ type: 'frame_step', direction: 'forward' });
    expect(resolvePlayerKeyAction({ key: '[' })).toEqual({ type: 'speed_delta', delta: -SPEED_STEP });
    // No speed up: ] and > do nothing outside clip mode.
    expect(resolvePlayerKeyAction({ key: ']' })).toBeNull();
    expect(resolvePlayerKeyAction({ key: '>' })).toBeNull();
    expect(resolvePlayerKeyAction({ key: 'd' })).toEqual({ type: 'toggle_night_mode' });
    expect(resolvePlayerKeyAction({ key: 'D' })).toEqual({ type: 'toggle_night_mode' });
    expect(resolvePlayerKeyAction({ key: 'c' })).toEqual({ type: 'cycle_track', kind: 'sub' });
    expect(resolvePlayerKeyAction({ key: 'a' })).toEqual({ type: 'cycle_track', kind: 'audio' });
    expect(resolvePlayerKeyAction({ key: '0' })).toEqual({ type: 'seek_fraction', fraction: 0 });
    expect(resolvePlayerKeyAction({ key: '5' })).toEqual({ type: 'seek_fraction', fraction: 0.5 });
    expect(resolvePlayerKeyAction({ key: '9' })).toEqual({ type: 'seek_fraction', fraction: 0.9 });
    expect(resolvePlayerKeyAction({ key: 'Home' })).toEqual({ type: 'seek_start' });
    expect(resolvePlayerKeyAction({ key: 'End' })).toEqual({ type: 'seek_end' });
    // Punctuation ignores the shift state (layout-dependent).
    expect(resolvePlayerKeyAction({ key: '[', shiftKey: true })).toEqual({ type: 'speed_delta', delta: -SPEED_STEP });
  });

  it('clamps the speed to 0.25–1: slower is fine, faster never', () => {
    expect(clampSpeed(1 + SPEED_STEP)).toBe(1);
    expect(clampSpeed(2)).toBe(1);
    expect(clampSpeed(0.75 + SPEED_STEP)).toBe(1);
    expect(clampSpeed(0.25 - SPEED_STEP)).toBe(0.25);
    expect(clampSpeed(0.1 + 0.2)).toBe(0.3);
  });

  it('never binds a key that raises the speed', () => {
    for (const binding of PLAYER_KEY_BINDINGS) {
      const action = bindingAction(binding, typeof binding.keys === 'string' ? binding.keys : binding.keys[0]);
      if (action.type === 'speed_delta') expect(action.delta).toBeLessThan(0);
    }
  });

  it('binding ids are unique and every binding carries an i18n description', () => {
    const ids = PLAYER_KEY_BINDINGS.map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const binding of PLAYER_KEY_BINDINGS) {
      expect(binding.id.startsWith('player.')).toBe(true);
      expect(binding.description.startsWith('shortcuts.player_')).toBe(true);
    }
  });
});

describe('clip mode keys', () => {
  it('only shadow speed down, and only while clip mode is on', () => {
    expect(clipKeyConflicts()).toEqual(['player.speed_down']);
  });

  it('use unique ids and combos', () => {
    expect(new Set(CLIP_KEY_BINDINGS.map(binding => binding.id)).size).toBe(CLIP_KEY_BINDINGS.length);
    expect(new Set(CLIP_KEY_BINDINGS.map(binding => binding.keys)).size).toBe(CLIP_KEY_BINDINGS.length);
  });
});
