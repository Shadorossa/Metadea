import { STAR_PATH } from './constants';
import { STORAGE_KEYS } from '../shared/storage-keys';
import { getUserInfo } from '../tauri';

export type RatingSystem = '5-star' | '10-dec' | '10' | '3-emoji';

export function getActiveRatingSystem(): RatingSystem {
  if (typeof window === 'undefined') return '5-star';
  return (localStorage.getItem(STORAGE_KEYS.ratingSystem) as RatingSystem) || '5-star';
}

// DB (user_profile.rating_system) is the source of truth; localStorage is a
// fast read cache. It only gets refreshed from the DB when the Settings page
// runs — any other page (profile stats, library, reviews) that only calls
// getActiveRatingSystem() can read a stale or never-set cache, e.g. on a
// fresh session/device where Settings was never opened. Call this once
// before reading the active system on those pages.
export async function syncActiveRatingSystem(): Promise<RatingSystem> {
  if (typeof window === 'undefined') return '5-star';
  const info = await getUserInfo().catch(() => ({} as Record<string, unknown>));
  const system = (info.rating_system as RatingSystem)
    || (localStorage.getItem(STORAGE_KEYS.ratingSystem) as RatingSystem)
    || '5-star';
  localStorage.setItem(STORAGE_KEYS.ratingSystem, system);
  return system;
}

export function dbRatingToStars5(rating: number): number {
  return Math.max(0, Math.min(5, rating / 2));
}

export function ratingToEmoji(rating: number): { emoji: string; color: string } {
  if (rating <= 3.5) return { emoji: '😞', color: '#ef4444' };
  if (rating > 7)    return { emoji: '😊', color: '#10b981' };
  return { emoji: '😐', color: '#f59e0b' };
}

const STAR_FULL  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="${STAR_PATH}"/></svg>`;
const STAR_HALF  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><path d="${STAR_PATH}" clip-path="polygon(0 0, 50% 0, 50% 100%, 0 100%)"/><path d="${STAR_PATH}" fill="none"/></svg>`;
const STAR_EMPTY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="${STAR_PATH}"/></svg>`;

/** Formats an average rating value (DB 0-10 scale) per the active rating system, with no unit suffix. */
export function formatAverageScore(avgVal: number, system: RatingSystem): string {
  if (system === '10-dec') return avgVal.toFixed(2);
  if (system === '10') return Math.round(avgVal).toString();
  if (system === '3-emoji') {
    const { emoji } = ratingToEmoji(avgVal);
    return `${emoji} (${avgVal.toFixed(1)})`;
  }
  return (avgVal / 2).toFixed(1);
}

/** Unit suffix to append after formatAverageScore's output (empty for the emoji system, which is self-contained). */
export function averageScoreSuffix(system: RatingSystem): string {
  if (system === '3-emoji') return '';
  return system === '10-dec' || system === '10' ? ' / 10' : ' / 5';
}

function buildStarHtml(rating: number, cssClass: string, wrapperStyle = ''): string {
  if (!rating) return '';
  const stars5 = dbRatingToStars5(rating);
  let html = '';
  for (let i = 1; i <= 5; i++) {
    if (stars5 >= i)             html += STAR_FULL;
    else if (stars5 >= i - 0.5) html += STAR_HALF;
    else                         html += STAR_EMPTY;
  }
  const style = wrapperStyle ? ` style="${wrapperStyle}"` : '';
  return `<span class="${cssClass}"${style}>${html}</span>`;
}

export function formatRatingHtml(
  rating: number | null | undefined,
  system: RatingSystem,
  cssClass: string,
): string {
  if (!rating) return `<span class="${cssClass}"></span>`;

  if (system === '10-dec') {
    return `<span class="${cssClass} text-rating" style="font-size:0.72rem;font-weight:700;color:var(--accent);">${Number(rating).toFixed(2)} / 10</span>`;
  }
  if (system === '10') {
    return `<span class="${cssClass} text-rating" style="font-size:0.72rem;font-weight:700;color:var(--accent);">${Math.round(rating)} / 10</span>`;
  }
  if (system === '3-emoji') {
    const { emoji, color } = ratingToEmoji(rating);
    return `<span class="${cssClass} emoji-rating" style="font-size:1.1rem;line-height:1;color:${color};">${emoji}</span>`;
  }

  return buildStarHtml(rating, cssClass);
}
