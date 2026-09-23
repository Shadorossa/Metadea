import { describe, expect, it } from 'vitest';
import {
  DRIVE_SCHEDULES, KEEP_LAST_DEFAULT, KEEP_LAST_MAX, KEEP_LAST_MIN,
  formatBytes, needsRelink, parseKeepLast, parseSchedule, progressLabelKey, progressPercent, scheduleLabelKey,
} from './backup-settings';
import { en } from '../../i18n/en';
// Vite's ?raw import keeps this free of node typings.
import scheduleSource from '../../../src-tauri/src/google_drive/schedule.rs?raw';

describe('drive schedule mapping', () => {
  it('accepts only the schedules Rust knows', () => {
    expect(DRIVE_SCHEDULES).toEqual(['off', 'daily', 'weekly']);
    for (const value of DRIVE_SCHEDULES) expect(parseSchedule(value)).toBe(value);
    expect(parseSchedule('hourly')).toBe('off');
    expect(parseSchedule(null)).toBe('off');
  });

  it('mirrors the Rust enum and keep-last bounds', () => {
    for (const variant of ['Off', 'Daily', 'Weekly']) expect(scheduleSource).toContain(`    ${variant},`);
    expect(scheduleSource).toContain(`MIN_KEEP_LAST: u32 = ${KEEP_LAST_MIN};`);
    expect(scheduleSource).toContain(`MAX_KEEP_LAST: u32 = ${KEEP_LAST_MAX};`);
    expect(scheduleSource).toContain(`DEFAULT_KEEP_LAST: u32 = ${KEEP_LAST_DEFAULT};`);
  });

  it('clamps keep-last input', () => {
    expect(parseKeepLast('3')).toBe(3);
    expect(parseKeepLast(0)).toBe(KEEP_LAST_MIN);
    expect(parseKeepLast('999')).toBe(KEEP_LAST_MAX);
    expect(parseKeepLast('abc')).toBe(KEEP_LAST_DEFAULT);
    expect(parseKeepLast(4.7)).toBe(4);
  });

  it('labels every schedule and phase with an existing key', () => {
    for (const schedule of DRIVE_SCHEDULES) expect(en.backup[scheduleLabelKey(schedule)]).toBeTypeOf('string');
    for (const phase of ['snapshot', 'hashing', 'compress', 'extract', 'safety_backup', 'upload', 'download', 'done', 'mystery']) {
      expect(en.backup[progressLabelKey(phase)]).toBeTypeOf('string');
    }
    expect(progressLabelKey('mystery')).toBe('phase_working');
  });
});

describe('backup formatting', () => {
  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(35 * 1024 * 1024)).toBe('35.0 MB');
    expect(formatBytes(null)).toBe('—');
  });

  it('clamps progress', () => {
    expect(progressPercent(-3)).toBe(0);
    expect(progressPercent(42.6)).toBe(43);
    expect(progressPercent(140)).toBe(100);
    expect(progressPercent(Number.NaN)).toBe(0);
  });

  it('detects errors that need a new Drive link', () => {
    expect(needsRelink('E_GDRIVE_AUTH: 400 invalid_grant')).toBe(true);
    expect(needsRelink('E_GDRIVE_NETWORK: timeout')).toBe(false);
    expect(needsRelink(null)).toBe(false);
  });
});
