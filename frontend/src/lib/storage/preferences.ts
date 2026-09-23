// Small, framework-free user preferences read directly from localStorage —
// shared between the settings page (writer) and any consumer that needs to
// read them without importing the whole settings UI (e.g. search providers).

import { STORAGE_KEYS } from './storage-keys';
import type { RatingSystem } from '../media/rating-utils';

export function isAdultContentEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.showAdultContent) === 'true';
}

export function setAdultContentEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.showAdultContent, enabled.toString());
}

// Defaults to ON (grouped) when never touched — a bundle a user has logged
// directly (e.g. "Final Fantasy VII Remake Intergrade") alongside its own
// separately-logged contents (Remake, Episode Intermission) is otherwise
// redundant with them: the same playthrough counted a third time as its
// own library card. Explicitly turning it off (stored 'false') still wins,
// for anyone who genuinely wants every piece shown ungrouped.
export function isLibraryGroupByBundleEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.libraryGroupByBundle) !== 'false';
}

export function setLibraryGroupByBundleEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.libraryGroupByBundle, enabled.toString());
}

// ── ROM clean-up (Settings > Emuladores) ───────────────────────────────────
// `local.roms.auto_rename`: after each ROM scan, dump-style file names are
// renamed to their clean title (see lib/local/rom-rename-plan.ts). Defaults
// to ON (owner's call); only an explicit 'false' turns it off.
export function isRomAutoRenameEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.romAutoRename) !== 'false';
}

export function setRomAutoRenameEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.romAutoRename, enabled.toString());
}

// ── Doble calificación (Settings > Preferencias) ────────────────────────────
// A device-level opt-in; the daily profile sync publishes it (names, system,
// range — see buildDualRatingPayload in lib/social/profile-sync-payload.ts)
// so a public profile shows rating_2 the owner's way. rating (the
// "default"/primary one) always uses
// the app-wide rating system already configured elsewhere; rating_2 gets its
// own, independent one, since there's no reason the two need to look alike
// (e.g. stars for the everyday rating, decimals for a stricter one).

export function isDualRatingEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.dualRatingEnabled) === 'true';
}

export function setDualRatingEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.dualRatingEnabled, enabled.toString());
}

// ── Perfil web público (Settings > Perfil) ──────────────────────────────────
// Opt-in, off unless explicitly turned on: the daily profile sync sends it
// as web_profile_public and the metadea-web Worker only renders
// https://metadea.pages.dev/u/<id> while it's true (see
// lib/social/web-profile-payload.ts). null = never chosen on this device:
// its sync then leaves the server's value alone, so a second device can't
// silently turn off what the first one turned on.

export function getWebProfilePublicChoice(): boolean | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.webProfilePublic);
    return raw === 'true' ? true : raw === 'false' ? false : null;
  } catch {
    return null;
  }
}

export function setWebProfilePublic(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.webProfilePublic, enabled.toString());
}

export function getRatingName1(fallback: string): string {
  return localStorage.getItem(STORAGE_KEYS.ratingName1) || fallback;
}

export function setRatingName1(name: string): void {
  localStorage.setItem(STORAGE_KEYS.ratingName1, name);
}

export function getRatingName2(fallback: string): string {
  return localStorage.getItem(STORAGE_KEYS.ratingName2) || fallback;
}

export function setRatingName2(name: string): void {
  localStorage.setItem(STORAGE_KEYS.ratingName2, name);
}

export function getRating2System(): RatingSystem {
  return (localStorage.getItem(STORAGE_KEYS.rating2System) as RatingSystem) || '5-star';
}

export function setRating2System(system: RatingSystem): void {
  localStorage.setItem(STORAGE_KEYS.rating2System, system);
}

// Custom min/max for rating_2 — only meaningful for the '10-dec'/'10'
// systems (a numeric range), never 5-star/3-emoji, which have no such
// range to customize. Scoped to rating_2 only: the primary rating always
// uses the app-wide 0-10 scale everyone else's ratings/averages/sorting
// already assume. Existing saved ratings are never rescaled when this
// changes — a "7" stays a raw "7" even if the range around it moves.
export function getRating2Min(): number {
  const raw = localStorage.getItem(STORAGE_KEYS.rating2Min);
  const parsed = raw === null ? NaN : parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function setRating2Min(min: number): void {
  localStorage.setItem(STORAGE_KEYS.rating2Min, String(min));
}

export function getRating2Max(): number {
  const raw = localStorage.getItem(STORAGE_KEYS.rating2Max);
  const parsed = raw === null ? NaN : parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 10;
}

export function setRating2Max(max: number): void {
  localStorage.setItem(STORAGE_KEYS.rating2Max, String(max));
}

// Which rating the profile library's own selector currently shows/sorts by
// — persisted so it doesn't reset to the primary one on every visit.
export type RatingSlot = 'rating' | 'rating_2';

export function getActiveRatingSlot(): RatingSlot {
  return localStorage.getItem(STORAGE_KEYS.libraryActiveRatingSlot) === 'rating_2' ? 'rating_2' : 'rating';
}

export function setActiveRatingSlot(slot: RatingSlot): void {
  localStorage.setItem(STORAGE_KEYS.libraryActiveRatingSlot, slot);
}

// ── Unificar temporadas de AniList (Settings > Preferencias) ────────────────
// Off by default — the untouched state must stay exactly what every AniList
// season already looks like today (its own library card, its own row in
// Relacionados via PREQUEL/SEQUEL). Turning this on is what switches an
// anime's chain of seasons over to the TMDB-style single-entity view: one
// fused library card (see library-grouping.ts's refineSagaGroups), a
// "Temporadas" tab on the media page instead of PREQUEL/SEQUEL rows under
// Relacionados, and hides (never deletes) the SagaViewerModal entry point,
// which the new tab supersedes while this is on.
export function isUnifySeasonsEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.unifySeasonsEnabled) === 'true';
}

export function setUnifySeasonsEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.unifySeasonsEnabled, enabled.toString());
}

export function isUnifySeasonsHighestRatedCoverEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.unifySeasonsHighestRatedCover) === 'true';
}

export function setUnifySeasonsHighestRatedCoverEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.unifySeasonsHighestRatedCover, enabled.toString());
}

// Defaults to ON to preserve the current library behavior. This only affects
// completed manga; active, paused, and dropped progress still uses its matching
// next-volume issue cover, and comics are unaffected.
export function isCompletedMangaIssueCoverEnabled(): boolean {
  return typeof localStorage === 'undefined'
    || localStorage.getItem(STORAGE_KEYS.completedMangaIssueCover) !== 'false';
}

export function setCompletedMangaIssueCoverEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.completedMangaIssueCover, enabled.toString());
}

// ── Portadas limpias (Settings > Preferencias > Biblioteca) ─────────────────
// Off by default. When on, covers render a textless version (TMDB posters
// with no language, IGDB key art cropped to the cover box) where the
// provider really has one — display-only, the catalog's cover_url is never
// changed and a user's manual cover (cover-preferences.ts) always wins. The
// event lets every mounted cover swap live (lib/media/textless-covers.ts).
export const TEXTLESS_COVERS_CHANGED_EVENT = 'textless-covers-changed';

export function isTextlessCoversEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEYS.preferTextlessCovers) === 'true';
  } catch {
    return false;
  }
}

export function setTextlessCoversEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.preferTextlessCovers, enabled.toString());
  window.dispatchEvent(new Event(TEXTLESS_COVERS_CHANGED_EVENT));
}

/** Which works get clean covers: everything eligible, only films/series
 *  (TMDB) or only games/visual novels (IGDB). */
export type TextlessCoverScope = 'all' | 'screen' | 'games';
const TEXTLESS_COVER_SCOPES: readonly TextlessCoverScope[] = ['all', 'screen', 'games'];

export function getTextlessCoverScope(): TextlessCoverScope {
  if (typeof localStorage === 'undefined') return 'all';
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.textlessCoverScope);
    return TEXTLESS_COVER_SCOPES.find(scope => scope === stored) ?? 'all';
  } catch {
    return 'all';
  }
}

export function setTextlessCoverScope(scope: TextlessCoverScope): void {
  localStorage.setItem(STORAGE_KEYS.textlessCoverScope, scope);
  window.dispatchEvent(new Event(TEXTLESS_COVERS_CHANGED_EVENT));
}

// ── Ambient TV mode (lib/ambient/) ──────────────────────────────────────────
// Device-level, default ON: after `getAmbientIdleMinutes()` idle minutes in
// fullscreen or Big Picture the screensaver starts; `isAmbientJukeboxEnabled`
// lets it start the Jukebox when nothing is playing. Every write fires
// AMBIENT_MODE_CHANGED_EVENT so the idle watcher re-reads them.
export const AMBIENT_MODE_CHANGED_EVENT = 'ambient-mode-changed';
export const AMBIENT_IDLE_MINUTES_OPTIONS = [1, 2, 5, 10] as const;
export type AmbientIdleMinutes = (typeof AMBIENT_IDLE_MINUTES_OPTIONS)[number];
export const DEFAULT_AMBIENT_IDLE_MINUTES: AmbientIdleMinutes = 2;

function readStoredFlag(key: string, fallback: boolean): boolean {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

function writeAmbientSetting(key: string, value: string): void {
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(AMBIENT_MODE_CHANGED_EVENT));
}

export function isAmbientModeEnabled(): boolean {
  return readStoredFlag(STORAGE_KEYS.ambientMode, true);
}

export function setAmbientModeEnabled(enabled: boolean): void {
  writeAmbientSetting(STORAGE_KEYS.ambientMode, enabled.toString());
}

/** Anything outside the offered options (a hand-edited value) reads as the default. */
export function parseAmbientIdleMinutes(stored: string | null): AmbientIdleMinutes {
  const value = Number(stored);
  return AMBIENT_IDLE_MINUTES_OPTIONS.find(option => option === value) ?? DEFAULT_AMBIENT_IDLE_MINUTES;
}

export function getAmbientIdleMinutes(): AmbientIdleMinutes {
  if (typeof localStorage === 'undefined') return DEFAULT_AMBIENT_IDLE_MINUTES;
  try {
    return parseAmbientIdleMinutes(localStorage.getItem(STORAGE_KEYS.ambientIdleMinutes));
  } catch {
    return DEFAULT_AMBIENT_IDLE_MINUTES;
  }
}

export function setAmbientIdleMinutes(minutes: AmbientIdleMinutes): void {
  writeAmbientSetting(STORAGE_KEYS.ambientIdleMinutes, String(minutes));
}

export function isAmbientJukeboxEnabled(): boolean {
  return readStoredFlag(STORAGE_KEYS.ambientJukebox, true);
}

export function setAmbientJukeboxEnabled(enabled: boolean): void {
  writeAmbientSetting(STORAGE_KEYS.ambientJukebox, enabled.toString());
}

// Media page episodes' "Hide filler" toggle (AnimeFillerList data, see
// lib/anime/filler.ts). Mixed canon/filler episodes are never hidden.
export function isHideFillerEpisodesEnabled(): boolean {
  return readStoredFlag(STORAGE_KEYS.hideFillerEpisodes, false);
}

export function setHideFillerEpisodesEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEYS.hideFillerEpisodes, enabled.toString());
  } catch {
    // Storage unavailable: the toggle still applies for this visit.
  }
}
