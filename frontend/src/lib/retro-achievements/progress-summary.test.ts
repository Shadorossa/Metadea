import { describe, it, expect } from 'vitest';
import { awardTier, diffUnlocks, formatUnlockToast, isHardcoreAward, summarizeProgress } from './progress-summary';
import type { RaAchievement, RaGameProgress } from '../tauri/retro-achievements';

function achievement(id: number, unlocked: boolean, hardcore = false, points = 5): RaAchievement {
  return {
    id, title: `A${id}`, description: '', points, trueRatio: points, badgeName: String(id),
    badgeUrl: `https://media.retroachievements.org/Badge/${id}.png`,
    badgeLockedUrl: `https://media.retroachievements.org/Badge/${id}_lock.png`,
    displayOrder: id, kind: null,
    dateEarned: unlocked ? '2026-09-21 10:00:00' : null,
    dateEarnedHardcore: unlocked && hardcore ? '2026-09-21 10:00:00' : null,
    unlocked, unlockedHardcore: unlocked && hardcore,
  };
}

function progress(achievements: RaAchievement[], overrides: Partial<RaGameProgress> = {}): RaGameProgress {
  const unlocked = achievements.filter(a => a.unlocked);
  return {
    gameId: 1446, title: 'Test Quest', consoleId: 18, consoleName: 'Nintendo DS', iconUrl: null,
    total: achievements.length, unlocked: unlocked.length,
    unlockedHardcore: unlocked.filter(a => a.unlockedHardcore).length,
    pointsTotal: achievements.reduce((sum, a) => sum + a.points, 0),
    pointsUnlocked: unlocked.reduce((sum, a) => sum + a.points, 0),
    completionPct: null, completionHardcorePct: null, highestAwardKind: null, highestAwardDate: null,
    achievements, ...overrides,
  };
}

describe('summarizeProgress', () => {
  it('reports counts, points, the label and the award', () => {
    const summary = summarizeProgress(progress(
      [achievement(1, true, true, 10), achievement(2, true, true, 5), achievement(3, false, false, 20)],
      { highestAwardKind: 'beaten-hardcore' },
    ));
    expect(summary).toMatchObject({ raGameId: 1446, unlocked: 2, total: 3, pointsUnlocked: 15, pointsTotal: 35, label: '2/3', award: 'beaten-hardcore' });
    expect(summary.hardcore).toBe(true);
  });

  it('is not hardcore when any unlock was softcore or nothing is unlocked', () => {
    expect(summarizeProgress(progress([achievement(1, true, true), achievement(2, true, false)])).hardcore).toBe(false);
    expect(summarizeProgress(progress([achievement(1, false)])).hardcore).toBe(false);
  });
});

describe('awardTier', () => {
  it('collapses RA award kinds into the two badges the UI shows', () => {
    expect(awardTier('mastered')).toBe('mastery');
    expect(awardTier('completed')).toBe('mastery');
    expect(awardTier('beaten-hardcore')).toBe('beaten');
    expect(awardTier('beaten-softcore')).toBe('beaten');
    expect(awardTier(null)).toBeNull();
    expect(awardTier(undefined)).toBeNull();
    expect(isHardcoreAward('mastered')).toBe(true);
    expect(isHardcoreAward('beaten-softcore')).toBe(false);
  });
});

describe('diffUnlocks', () => {
  it('counts only achievements that went from locked to unlocked', () => {
    const before = progress([achievement(1, true), achievement(2, false), achievement(3, false)]);
    const after = progress([achievement(1, true), achievement(2, true), achievement(3, true)]);
    expect(diffUnlocks(before, after)).toEqual({ newlyUnlocked: [2, 3], count: 2 });
  });

  it('reports nothing on a first read, for a different game, or when nothing changed', () => {
    const after = progress([achievement(1, true)]);
    expect(diffUnlocks(null, after).count).toBe(0);
    expect(diffUnlocks(progress([achievement(1, false)], { gameId: 99 }), after).count).toBe(0);
    expect(diffUnlocks(after, after).count).toBe(0);
  });

  it('ignores achievements that became locked again (a hardcore reset)', () => {
    const before = progress([achievement(1, true), achievement(2, true)]);
    const after = progress([achievement(1, true), achievement(2, false)]);
    expect(diffUnlocks(before, after).count).toBe(0);
  });
});

describe('formatUnlockToast', () => {
  const templates = { one: '+{count} logro', many: '+{count} logros' };

  it('picks the singular or plural template and fills the count', () => {
    expect(formatUnlockToast(1, templates)).toBe('+1 logro');
    expect(formatUnlockToast(4, templates)).toBe('+4 logros');
  });

  it('returns null when nothing was unlocked', () => {
    expect(formatUnlockToast(0, templates)).toBeNull();
    expect(formatUnlockToast(-2, templates)).toBeNull();
  });
});
