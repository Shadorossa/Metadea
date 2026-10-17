import type { SteamAchievement } from '../tauri';

export interface MergedSteamAchievement {
  achievement: SteamAchievement;
  legacy: boolean;
}

export interface MergedSteamAchievementSet {
  unlocked: number;
  total: number;
  list: MergedSteamAchievement[];
}

type AchievementSet = { unlocked: number; total: number; list: SteamAchievement[] } | null | undefined;

/** Combines edition achievements by Steam API name, then localized title. */
export function mergeSteamEditionAchievements(current: AchievementSet, legacy?: AchievementSet): MergedSteamAchievementSet {
  const byApiName = new Map<string, MergedSteamAchievement>();
  const currentByTitle = new Map<string, SteamAchievement>();
  for (const achievement of current?.list ?? []) {
    byApiName.set(achievement.apiname, { achievement, legacy: false });
    const title = achievement.name?.trim().toLocaleLowerCase();
    if (title) currentByTitle.set(title, achievement);
  }

  for (const achievement of legacy?.list ?? []) {
    const title = achievement.name?.trim().toLocaleLowerCase();
    const currentMatch = byApiName.get(achievement.apiname)?.achievement
      ?? (title ? currentByTitle.get(title) : undefined);
    if (currentMatch) {
      // Prefer the current edition when unlocked there. If it is still
      // locked, retain a Legacy unlock as a muted, single trophy.
      if (!currentMatch.achieved && achievement.achieved) {
        byApiName.set(currentMatch.apiname, { achievement, legacy: true });
      }
    } else {
      // Edition-exclusive Legacy achievements are part of the combined set,
      // but aren't competing with a current-version achievement, so keep the
      // normal achievement color.
      byApiName.set(`legacy:${achievement.apiname}`, { achievement, legacy: false });
    }
  }

  const entries = [...byApiName.values()];
  const list = legacy
    ? [
        ...entries.filter(entry => !entry.legacy && !!entry.achievement.achieved),
        ...entries.filter(entry => !entry.legacy && !entry.achievement.achieved),
        ...entries.filter(entry => entry.legacy),
      ]
    : entries;
  return {
    unlocked: list.filter(entry => !!entry.achievement.achieved).length,
    total: list.length,
    list,
  };
}
