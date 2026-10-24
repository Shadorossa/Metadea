import { describe, expect, it } from 'vitest';
import { emulatorLacksRetroAchievements } from './emulator-catalog';

describe('emulatorLacksRetroAchievements', () => {
  it('flags an emulator without an RA client on a platform RA covers', () => {
    expect(emulatorLacksRetroAchievements('ds', 'melonDS')).toBe(true);
    expect(emulatorLacksRetroAchievements('ps1', 'ePSXe')).toBe(true);
  });

  it('accepts emulators that report to RA', () => {
    expect(emulatorLacksRetroAchievements('ds', 'RetroArch')).toBe(false);
    expect(emulatorLacksRetroAchievements('ps2', 'PCSX2')).toBe(false);
    expect(emulatorLacksRetroAchievements('wii', 'Dolphin')).toBe(false);
  });

  it('stays quiet without an emulator, an RA platform or a known emulator', () => {
    expect(emulatorLacksRetroAchievements('ds', '')).toBe(false);
    expect(emulatorLacksRetroAchievements('switch', 'Ryujinx')).toBe(false);
    expect(emulatorLacksRetroAchievements('ds', 'SomeCustomBuild')).toBe(false);
  });
});
