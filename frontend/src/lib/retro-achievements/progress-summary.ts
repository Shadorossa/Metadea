// Pure derivations over RetroAchievements progress: the compact summary the
// Discord presence layer and the detail panel's stats row show, and the
// "+N achievements" diff computed when a game session ends.
import type { RaAwardKind, RaGameProgress } from '../tauri/retro-achievements';

export interface RetroProgressSummary {
  raGameId: number;
  unlocked: number;
  total: number;
  pointsUnlocked: number;
  pointsTotal: number;
  // Every unlocked achievement was earned in hardcore mode.
  hardcore: boolean;
  award: RaAwardKind | null;
  // "12/40" — what a presence line or a stat cell shows.
  label: string;
}

export function summarizeProgress(progress: RaGameProgress): RetroProgressSummary {
  const hardcore = progress.unlocked > 0 && progress.unlockedHardcore >= progress.unlocked;
  return {
    raGameId: progress.gameId,
    unlocked: progress.unlocked,
    total: progress.total,
    pointsUnlocked: progress.pointsUnlocked,
    pointsTotal: progress.pointsTotal,
    hardcore,
    award: progress.highestAwardKind,
    label: `${progress.unlocked}/${progress.total}`,
  };
}

// The award badge to show, if any: RA's HighestAwardKind, reduced to the
// two tiers the UI distinguishes.
export type AwardTier = 'mastery' | 'beaten';

export function awardTier(kind: RaAwardKind | null | undefined): AwardTier | null {
  switch (kind) {
    case 'mastered':
    case 'completed':
      return 'mastery';
    case 'beaten-hardcore':
    case 'beaten-softcore':
      return 'beaten';
    default:
      return null;
  }
}

export function isHardcoreAward(kind: RaAwardKind | null | undefined): boolean {
  return kind === 'mastered' || kind === 'beaten-hardcore';
}

export interface UnlockDiff {
  // Achievement ids unlocked in `after` that were locked in `before`.
  newlyUnlocked: number[];
  count: number;
}

// Achievements that became unlocked between two reads of the same game. A
// first read (no `before`) never counts as new, and neither does anything
// that was already unlocked — so a stale-then-fresh pair of reads only
// reports what the session actually earned.
export function diffUnlocks(before: RaGameProgress | null, after: RaGameProgress): UnlockDiff {
  if (!before || before.gameId !== after.gameId) return { newlyUnlocked: [], count: 0 };
  const wasUnlocked = new Set(before.achievements.filter(a => a.unlocked).map(a => a.id));
  const newlyUnlocked = after.achievements.filter(a => a.unlocked && !wasUnlocked.has(a.id)).map(a => a.id);
  return { newlyUnlocked, count: newlyUnlocked.length };
}

// "+N logros" / "+1 logro" from the two translated templates.
export function formatUnlockToast(count: number, templates: { one: string; many: string }): string | null {
  if (count <= 0) return null;
  return (count === 1 ? templates.one : templates.many).replace('{count}', String(count));
}
