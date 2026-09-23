import { describe, it, expect } from 'vitest';
import {
  buildGameStateLine, emulatorNameFromExe, isRefreshDue, platformDisplayName, platformPresenceImage,
  sameAchievementCount, RETRO_ACHIEVEMENTS_REFRESH_MS, STEAM_ACHIEVEMENTS_REFRESH_MS,
} from './game-rich-presence';

describe('platformPresenceImage', () => {
  it('maps ROM platform ids to the published console icons', () => {
    expect(platformPresenceImage('ds')).toBe('https://metadea.pages.dev/platforms/ds.png');
    expect(platformPresenceImage('ps2')).toBe('https://metadea.pages.dev/platforms/ps2.png');
  });

  it('falls back to no small image for unknown or missing platforms', () => {
    expect(platformPresenceImage('xbox360')).toBeUndefined();
    expect(platformPresenceImage('')).toBeUndefined();
    expect(platformPresenceImage(null)).toBeUndefined();
  });

  it('names consoles and emulators', () => {
    expect(platformDisplayName('ds')).toBe('Nintendo DS');
    expect(platformDisplayName('nope')).toBeUndefined();
    expect(emulatorNameFromExe(String.raw`C:\Emus\melonDS\melonDS.exe`)).toBe('melonDS');
    expect(emulatorNameFromExe('/opt/pcsx2/pcsx2-qt')).toBe('pcsx2-qt');
    expect(emulatorNameFromExe(null)).toBeUndefined();
  });
});

describe('buildGameStateLine', () => {
  it('prefers achievements, with hardcore when known', () => {
    expect(buildGameStateLine({ achievements: { unlocked: 14, total: 35 }, platformName: 'Nintendo DS' }))
      .toBe('14 / 35 achievements');
    expect(buildGameStateLine({ achievements: { unlocked: 3, total: 40, hardcore: true } }))
      .toBe('3 / 40 achievements · Hardcore');
  });

  it('shows the console and emulator for ROMs without achievements', () => {
    expect(buildGameStateLine({ achievements: { unlocked: 0, total: 0 }, platformName: 'Nintendo DS', emulatorName: 'melonDS' }))
      .toBe('Nintendo DS · melonDS');
    expect(buildGameStateLine({ platformName: 'PlayStation 2' })).toBe('PlayStation 2');
  });

  it('is empty when nothing applies', () => {
    expect(buildGameStateLine({})).toBe('');
  });
});

describe('refresh throttling', () => {
  it('is due first, then only once the interval passed', () => {
    const t0 = 1_000_000;
    expect(isRefreshDue(null, t0, STEAM_ACHIEVEMENTS_REFRESH_MS)).toBe(true);
    expect(isRefreshDue(t0, t0 + STEAM_ACHIEVEMENTS_REFRESH_MS - 1, STEAM_ACHIEVEMENTS_REFRESH_MS)).toBe(false);
    expect(isRefreshDue(t0, t0 + STEAM_ACHIEVEMENTS_REFRESH_MS, STEAM_ACHIEVEMENTS_REFRESH_MS)).toBe(true);
    expect(isRefreshDue(t0, t0 + RETRO_ACHIEVEMENTS_REFRESH_MS, RETRO_ACHIEVEMENTS_REFRESH_MS)).toBe(true);
    expect(isRefreshDue(t0, t0 - 5_000, RETRO_ACHIEVEMENTS_REFRESH_MS)).toBe(true);
  });

  it('treats unchanged counts as no change', () => {
    expect(sameAchievementCount({ unlocked: 1, total: 5 }, { unlocked: 1, total: 5 })).toBe(true);
    expect(sameAchievementCount({ unlocked: 1, total: 5 }, { unlocked: 2, total: 5 })).toBe(false);
    expect(sameAchievementCount({ unlocked: 1, total: 5 }, { unlocked: 1, total: 5, hardcore: true })).toBe(false);
    expect(sameAchievementCount(undefined, undefined)).toBe(true);
    expect(sameAchievementCount(undefined, { unlocked: 0, total: 1 })).toBe(false);
  });
});
