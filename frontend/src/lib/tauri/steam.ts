import { tauriCmd, tauriRun, tauriTry } from './bridge';
import type { SteamOwnedGame } from './local-library';
import { getLangCode } from '../../i18n/runtime';

// The app's locale (Settings → system language → English) as a Steam Web
// API language name — achievement names/descriptions follow the UI, not the
// OS. Catalan has no Steam translation; Spanish is the closest one it has.
const STEAM_LANGUAGE_BY_LOCALE: Record<string, string> = {
  en: 'english', es: 'spanish', ca: 'spanish', de: 'german',
  fr: 'french', it: 'italian', ja: 'japanese', ru: 'russian',
};

export function steamLanguageForLocale(locale: string): string {
  return STEAM_LANGUAGE_BY_LOCALE[locale] ?? 'english';
}

export function steamLang(): string {
  return steamLanguageForLocale(getLangCode());
}

export interface SteamAchievement {
  apiname:        string;
  achieved:       number;
  hidden?:        boolean;
  unlocktime:     number;
  name?:          string;
  description?:   string;
  // Remote icon for the current unlock state (Steam CDN / RetroAchievements).
  icon?:          string;
  // Absolute path of the downloaded icon for the current state, served
  // through the asset protocol; `icon` is the fallback when it's missing.
  icon_local?:    string;
}

export interface SteamPlayerAchievements {
  unlocked: number;
  total:    number;
  list:     SteamAchievement[];
  // Unix seconds of the Steam fetch this was merged from.
  fetched_at?: number;
}

export interface SteamScreenshot {
  path: string;
  thumbnail_path: string;
}

export async function steamAchievementsDownload(appId: string): Promise<void> {
  return tauriRun('steam_achievements_download', { appId, lang: steamLang() });
}

// Live: GetPlayerAchievements (+ GetSchemaForGame when its 7-day cache is
// stale), merged and persisted for steamGetCachedAchievements.
export async function steamGetPlayerAchievements(appId: number, lang = steamLang()): Promise<SteamPlayerAchievements | null> {
  return tauriTry<SteamPlayerAchievements | null>('steam_get_player_achievements', null, { appId, lang });
}

// Disk only: the last merged result for (game, language), else the
// "Obtener metadatos" download. Never touches the network.
export async function steamGetCachedAchievements(appId: number, lang = steamLang()): Promise<SteamPlayerAchievements | null> {
  return tauriTry<SteamPlayerAchievements | null>('steam_get_cached_achievements', null, { appId, lang });
}

export async function steamGetScreenshots(appId: string): Promise<SteamScreenshot[]> {
  return tauriCmd<SteamScreenshot[]>('steam_get_screenshots', [], { appId });
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
