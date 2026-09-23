import { STAR_PATH } from './constants';
import { STORAGE_KEYS } from '../storage/storage-keys';
import { getUserInfo } from '../tauri/steam';

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

/** DB 0-10 rating → the 1-10 integer scale MyAnimeList scores use; 0 (or
 *  nothing) stays 0, MAL's "no score". Any positive rating is at least 1 so
 *  a low score is never mistaken for "unset". */
export function dbRatingToTenPointInt(rating: number | null | undefined): number {
  if (!rating || rating <= 0) return 0;
  return Math.max(1, Math.min(10, Math.round(rating)));
}

export function ratingToEmoji(rating: number): { emoji: string; color: string } {
  if (rating <= 3.5) return { emoji: '😞', color: '#ef4444' };
  if (rating > 7)    return { emoji: '😊', color: '#10b981' };
  return { emoji: '😐', color: '#f59e0b' };
}

// Consistent alignment/stroke across full, empty, and partial stars — a
// bare <svg> defaults to vertical-align:baseline, which sits lower than an
// inline-block sibling, and a mismatched stroke-width between the full and
// empty variants changes their effective visual size at this tiny 14px.
const STAR_BASE_STYLE = 'display:inline-block;vertical-align:middle;line-height:0;';
const STAR_STROKE_WIDTH = 1.25;
const STAR_FULL  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="${STAR_STROKE_WIDTH}" style="${STAR_BASE_STYLE}"><path d="${STAR_PATH}"/></svg>`;
const STAR_EMPTY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${STAR_STROKE_WIDTH}" style="${STAR_BASE_STYLE}"><path d="${STAR_PATH}"/></svg>`;

// Built directly rather than derived from STAR_FULL via string
// manipulation, so there's only ever one `style` attribute on the tag.
function starFullClipped(clipRightPct: string): string {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="${STAR_STROKE_WIDTH}" style="${STAR_BASE_STYLE}clip-path:inset(0 ${clipRightPct}% 0 0);"><path d="${STAR_PATH}"/></svg>`;
}

/** Formats an average rating value (DB 0-10 scale, or rating_2's own custom
 *  range) per the active rating system, with no unit suffix. */
export function formatAverageScore(avgVal: number, system: RatingSystem): string {
  if (system === '10-dec') return avgVal.toFixed(2);
  if (system === '10') return Math.round(avgVal).toString();
  if (system === '3-emoji') {
    const { emoji } = ratingToEmoji(avgVal);
    return `${emoji} (${avgVal.toFixed(1)})`;
  }
  return (avgVal / 2).toFixed(1);
}

/** Unit suffix to append after formatAverageScore's output (empty for the
 *  emoji system, which is self-contained). `max` only matters for '10-dec'/
 *  '10' — rating_2's own custom range (getRating2Max) instead of the
 *  primary rating's fixed 10; every other caller keeps the default. */
export function averageScoreSuffix(system: RatingSystem, max = 10): string {
  if (system === '3-emoji') return '';
  return system === '10-dec' || system === '10' ? ` / ${max}` : ' / 5';
}

/** A 0-1 normalised rating (taste compatibility pairs) in the given
 *  system, with its suffix: "4.5 / 5", "9 / 10", "😊 (8.0)". */
export function formatUnitRating(value: number, system: RatingSystem): string {
  return formatAverageScore(value * 10, system) + averageScoreSuffix(system);
}

/** A 0-1 rating difference split into number and compact scale ("1.8",
 *  "/5") so the scale can be styled smaller — the emoji system has no
 *  meaningful "difference" emoji, so it reads as a decimal out of 10. */
export function unitRatingDiffParts(value: number, system: RatingSystem): { value: string; suffix: string } {
  const diffSystem: RatingSystem = system === '3-emoji' ? '10-dec' : system;
  return {
    value: formatAverageScore(value * 10, diffSystem),
    suffix: averageScoreSuffix(diffSystem).replace(/\s+/g, ''),
  };
}

// Fills each star to its exact fraction (e.g. a 4.25-star rating fills the
// 5th star to 25%, not just rounded to the nearest half) — an empty-star
// outline sits underneath, with a full star laid directly on top of it and
// clip-path:inset() cutting off the right (1-fill) share.
function buildPartialStarHtml(fill: number): string {
  if (fill <= 0) return STAR_EMPTY;
  if (fill >= 1) return STAR_FULL;
  const clipRight = (100 - fill * 100).toFixed(1);
  const clippedFull = starFullClipped(clipRight);
  return (
    `<span style="position:relative;display:inline-block;width:14px;height:14px;vertical-align:middle;line-height:0;">` +
      `<span style="position:absolute;top:0;left:0;">${STAR_EMPTY}</span>` +
      `<span style="position:absolute;top:0;left:0;">${clippedFull}</span>` +
    `</span>`
  );
}

function buildStarHtml(rating: number, cssClass: string, wrapperStyle = ''): string {
  if (!rating) return '';
  const stars5 = dbRatingToStars5(rating);
  let html = '';
  for (let i = 1; i <= 5; i++) {
    const fill = Math.max(0, Math.min(1, stars5 - (i - 1)));
    html += buildPartialStarHtml(fill);
  }
  const style = wrapperStyle ? ` style="${wrapperStyle}"` : '';
  return `<span class="${cssClass}"${style}>${html}</span>`;
}

export function formatRatingHtml(
  rating: number | null | undefined,
  system: RatingSystem,
  cssClass: string,
  // Only meaningful for '10-dec'/'10' — rating_2's own custom range
  // (getRating2Max) instead of the primary rating's fixed 10.
  max = 10,
): string {
  if (!rating) return `<span class="${cssClass}"></span>`;

  if (system === '10-dec' || system === '10') {
    const formattedVal = system === '10-dec'
      ? parseFloat(Number(rating).toFixed(2)).toString()
      : Math.round(rating).toString();
    return (
      `<span class="${cssClass} rating-pill rating-pill--num">` +
        `<span class="rating-pill-val">${formattedVal}</span>` +
        `<span class="rating-pill-max">/${max}</span>` +
      `</span>`
    );
  }
  if (system === '3-emoji') {
    const { emoji, color } = ratingToEmoji(rating);
    return `<span class="${cssClass} emoji-rating" style="font-size:1.1rem;line-height:1;color:${color};">${emoji}</span>`;
  }

  return buildStarHtml(rating, cssClass);
}
