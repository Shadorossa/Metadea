// Small, framework-free user preferences read directly from localStorage —
// shared between the settings page (writer) and any consumer that needs to
// read them without importing the whole settings UI (e.g. search providers).

import { STORAGE_KEYS } from '../shared/storage-keys';
import type { RatingSystem } from '../media/rating-utils';

export function isAdultContentEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.showAdultContent) === 'true';
}

export function setAdultContentEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.showAdultContent, enabled.toString());
}

export function isLibraryGroupByBundleEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.libraryGroupByBundle) === 'true';
}

export function setLibraryGroupByBundleEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.libraryGroupByBundle, enabled.toString());
}

// ── Doble calificación (Settings > Preferencias) ────────────────────────────
// A personal, device-level opt-in — not synced anywhere (see
// social-library-mapping.ts). rating (the "default"/primary one) always uses
// the app-wide rating system already configured elsewhere; rating_2 gets its
// own, independent one, since there's no reason the two need to look alike
// (e.g. stars for the everyday rating, decimals for a stricter one).

export function isDualRatingEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEYS.dualRatingEnabled) === 'true';
}

export function setDualRatingEnabled(enabled: boolean): void {
  localStorage.setItem(STORAGE_KEYS.dualRatingEnabled, enabled.toString());
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

// Which rating the profile library's own selector currently shows/sorts by
// — persisted so it doesn't reset to the primary one on every visit.
export type RatingSlot = 'rating' | 'rating_2';

export function getActiveRatingSlot(): RatingSlot {
  return localStorage.getItem(STORAGE_KEYS.libraryActiveRatingSlot) === 'rating_2' ? 'rating_2' : 'rating';
}

export function setActiveRatingSlot(slot: RatingSlot): void {
  localStorage.setItem(STORAGE_KEYS.libraryActiveRatingSlot, slot);
}
