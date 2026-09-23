// Maps RetroAchievements progress onto the exact shape the Steam
// achievements tab renders (MediaScreenshotsSection's `achievements` prop:
// `{ unlocked, total, list: SteamAchievement[] }`), so RA sets go through
// the same grid, cell, tooltip and CSS with no layout of their own. The
// cell loads a local Steam icon only when `icon_local` is set, so leaving
// it out and putting the right RA badge (locked
// variant for a locked one) in `icon` makes it render straight from
// media.retroachievements.org.
import type { SteamAchievement } from '../tauri/steam';
import type { RaAchievement, RaGameProgress } from '../tauri/retro-achievements';

export interface SteamAchievementsModel {
  unlocked: number;
  total: number;
  list: SteamAchievement[];
}

// Translated words for the RA-only extras the Steam cell has no slot for;
// they ride along in the tooltip's description line.
export interface AchievementExtraLabels {
  // "points" / "puntos"
  points: string;
  // "Hardcore"
  hardcore: string;
}

export function toAchievementCellModel(achievement: RaAchievement, labels?: AchievementExtraLabels): SteamAchievement {
  return {
    apiname: String(achievement.id),
    achieved: achievement.unlocked ? 1 : 0,
    unlocktime: unlockTimeSeconds(achievement.dateEarnedHardcore ?? achievement.dateEarned),
    name: achievement.title,
    description: labels ? describeWithExtras(achievement, labels) : achievement.description,
    icon: achievement.unlocked ? achievement.badgeUrl : achievement.badgeLockedUrl,
  };
}

// "Do the thing · 5 points · Hardcore"
export function describeWithExtras(achievement: RaAchievement, labels: AchievementExtraLabels): string {
  const parts = [achievement.description.trim(), `${achievement.points} ${labels.points}`];
  if (achievement.unlockedHardcore) parts.push(labels.hardcore);
  return parts.filter(Boolean).join(' · ');
}

// The whole set in RA's own display order, with the counters the Steam tab
// shows in its header.
export function toSteamAchievementsModel(progress: RaGameProgress, labels?: AchievementExtraLabels): SteamAchievementsModel {
  const list = [...progress.achievements]
    .sort((a, b) => a.displayOrder - b.displayOrder || a.id - b.id)
    .map(achievement => toAchievementCellModel(achievement, labels));
  return { unlocked: progress.unlocked, total: progress.total, list };
}

// RA dates come as "YYYY-MM-DD HH:MM:SS" (UTC, no zone) or ISO 8601.
export function unlockTimeSeconds(date: string | null | undefined): number {
  if (!date) return 0;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date) ? `${date.replace(' ', 'T')}Z` : date;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}
