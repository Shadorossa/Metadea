import { describe, it, expect } from 'vitest';
import { toAchievementCellModel, toSteamAchievementsModel, unlockTimeSeconds } from './achievement-cell-adapter';
import type { RaAchievement, RaGameProgress } from '../tauri/retro-achievements';

const base: RaAchievement = {
  id: 9001, title: 'First', description: 'Do the thing', points: 5, trueRatio: 6, badgeName: '12345',
  badgeUrl: 'https://media.retroachievements.org/Badge/12345.png',
  badgeLockedUrl: 'https://media.retroachievements.org/Badge/12345_lock.png',
  displayOrder: 1, kind: 'progression', dateEarned: null, dateEarnedHardcore: null,
  unlocked: false, unlockedHardcore: false,
};

describe('toAchievementCellModel', () => {
  it('uses the locked badge and no unlock time for a locked achievement', () => {
    const cell = toAchievementCellModel(base);
    expect(cell).toMatchObject({ apiname: '9001', achieved: 0, unlocktime: 0, name: 'First', description: 'Do the thing' });
    expect(cell.icon).toBe(base.badgeLockedUrl);
    expect(cell.icon_local).toBeUndefined();
  });

  it('uses the unlocked badge and the earned date for an unlocked one', () => {
    const cell = toAchievementCellModel({ ...base, unlocked: true, dateEarned: '2026-09-21 10:00:00' });
    expect(cell.achieved).toBe(1);
    expect(cell.icon).toBe(base.badgeUrl);
    expect(cell.unlocktime).toBe(Date.UTC(2026, 8, 21, 10) / 1000);
  });

  it('folds points and hardcore into the description when labels are given', () => {
    const labels = { points: 'points', hardcore: 'Hardcore' };
    expect(toAchievementCellModel(base, labels).description).toBe('Do the thing · 5 points');
    expect(toAchievementCellModel({ ...base, unlocked: true, unlockedHardcore: true }, labels).description)
      .toBe('Do the thing · 5 points · Hardcore');
    expect(toAchievementCellModel({ ...base, description: '  ' }, labels).description).toBe('5 points');
  });
});

describe('toSteamAchievementsModel', () => {
  const progress: RaGameProgress = {
    gameId: 1, title: 'Game', consoleId: 12, consoleName: 'PlayStation', iconUrl: null,
    total: 3, unlocked: 1, unlockedHardcore: 0, pointsTotal: 15, pointsUnlocked: 5,
    completionPct: null, completionHardcorePct: null, highestAwardKind: null, highestAwardDate: null,
    achievements: [
      { ...base, id: 3, displayOrder: 3 },
      { ...base, id: 1, displayOrder: 1, unlocked: true, dateEarned: '2026-09-21 10:00:00' },
      { ...base, id: 2, displayOrder: 2 },
    ],
  };

  it('produces the Steam tab shape in RA display order', () => {
    const model = toSteamAchievementsModel(progress);
    expect(model.unlocked).toBe(1);
    expect(model.total).toBe(3);
    expect(model.list.map(cell => cell.apiname)).toEqual(['1', '2', '3']);
    expect(model.list[0]).toMatchObject({ achieved: 1, icon: base.badgeUrl });
    expect(model.list[1]).toMatchObject({ achieved: 0, icon: base.badgeLockedUrl, unlocktime: 0 });
    // Steam-only fields stay unset so the cell never looks for a local icon.
    expect(model.list.every(cell => cell.icon_local === undefined && cell.hidden === undefined)).toBe(true);
  });
});

describe('unlockTimeSeconds', () => {
  it('parses RA timestamps as UTC and ISO dates as-is', () => {
    expect(unlockTimeSeconds('2026-09-21 10:00:00')).toBe(Date.UTC(2026, 8, 21, 10) / 1000);
    expect(unlockTimeSeconds('2026-09-21T10:00:00+02:00')).toBe(Date.UTC(2026, 8, 21, 8) / 1000);
    expect(unlockTimeSeconds(null)).toBe(0);
    expect(unlockTimeSeconds('nonsense')).toBe(0);
  });
});
