// Maps a digit key on the media page (1–9, 0 = 10) to a library rating on
// the 0–10 DB scale, per rating system. Pure so the mapping is unit-tested.
import type { RatingSystem } from './rating-utils';

/** DB rating (0–10) for a digit key, or `null` when the active system has no
 *  sensible digit mapping (3-emoji) or the key is not a digit. */
export function digitToDbRating(key: string, system: RatingSystem): number | null {
  if (!/^[0-9]$/.test(key)) return null;
  if (system === '3-emoji') return null;
  const value = key === '0' ? 10 : Number(key);
  // 5-star stores half stars as 0–10 too, so N maps to N/2 stars; the
  // 10-point systems take the digit as is.
  return value;
}

/** Whether digit shortcuts rate anything under this system. */
export function ratingSystemAcceptsDigits(system: RatingSystem): boolean {
  return system !== '3-emoji';
}
