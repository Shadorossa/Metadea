import { tauriRun, tauriTry } from './core';
import type { SteamOwnedGame } from './local-library';

function steamLang(): string {
  const l = navigator.language;
  if (l.startsWith('es')) return 'spanish';
  if (l.startsWith('fr')) return 'french';
  if (l.startsWith('de')) return 'german';
  if (l.startsWith('pt')) return 'portuguese';
  if (l.startsWith('it')) return 'italian';
  if (l.startsWith('ru')) return 'russian';
  if (l.startsWith('zh')) return 'schinese';
  if (l.startsWith('ja')) return 'japanese';
  if (l.startsWith('ko')) return 'koreana';
  return 'english';
}

export interface SteamAchievement {
  apiname:        string;
  achieved:       number;
  unlocktime:     number;
  name?:          string;
  description?:   string;
  icon?:          string;
  icon_unlocked?: string;
  icon_locked?:   string;
}

export async function steamAchievementsDownload(appId: string): Promise<void> {
  return tauriRun('steam_achievements_download', { appId, lang: steamLang() });
}

export async function steamAchievementIcon(appId: string, filename: string): Promise<string | null> {
  return tauriTry<string | null>('steam_achievement_icon', null, { appId, filename });
}

export async function steamGetPlayerAchievements(
  appId: number,
): Promise<{ unlocked: number; total: number; list: SteamAchievement[] } | null> {
  return tauriTry<{ unlocked: number; total: number; list: SteamAchievement[] } | null>(
    'steam_get_player_achievements', null, { appId, lang: steamLang() },
  );
}

export async function steamGetOwnedGames(): Promise<{ game_count?: number; games?: SteamOwnedGame[] } | null> {
  return tauriTry<{ game_count?: number; games?: SteamOwnedGame[] } | null>('steam_get_owned_games', null);
}

export async function saveUserInfo(info: Record<string, unknown>): Promise<void> {
  return tauriRun('save_user_info', { info });
}

export async function getUserInfo(): Promise<Record<string, unknown>> {
  return tauriTry<Record<string, unknown>>('get_user_info', {});
}
