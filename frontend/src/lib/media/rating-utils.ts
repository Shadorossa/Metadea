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

// display:inline-block + vertical-align:middle explicitly on every star
// (full/empty/partial alike) — a bare <svg> defaults to vertical-align:
// baseline, which sits lower than the wrapper span buildPartialStarHtml
// uses for a partial fill, so without this the one star in a row that
// happens to be partial visibly drops relative to its full/empty siblings.
// Same stroke-width on both (was 1 on the full star vs 1.5 on the empty
// one) — a mismatched stroke-width changes the glyph's effective visual
// footprint at this tiny 14px size, which reads as a size/position mismatch
// between full and empty stars regardless of vertical-align.
const STAR_BASE_STYLE = 'display:inline-block;vertical-align:middle;line-height:0;';
const STAR_STROKE_WIDTH = 1.25;
const STAR_FULL  = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="${STAR_STROKE_WIDTH}" style="${STAR_BASE_STYLE}"><path d="${STAR_PATH}"/></svg>`;
const STAR_EMPTY = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${STAR_STROKE_WIDTH}" style="${STAR_BASE_STYLE}"><path d="${STAR_PATH}"/></svg>`;

// Same STAR_FULL markup but with an extra clip-path — built directly
// (never via string-replace on STAR_FULL) so there's only ever one `style`
// attribute on the tag; a duplicated attribute is invalid HTML and browsers
// keep only the first one, silently dropping whichever half got appended.
function starFullClipped(clipRightPct: string): string {
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="${STAR_STROKE_WIDTH}" style="${STAR_BASE_STYLE}clip-path:inset(0 ${clipRightPct}% 0 0);"><path d="${STAR_PATH}"/></svg>`;
}

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

// Fills each star to its exact fraction (e.g. a 4.25-star rating fills the
// 5th star to 25%, not just rounded to the nearest half) — an empty-star
// outline sits underneath, with a full star laid directly on top of it and
// clip-path:inset() cutting off the right (1-fill) share. clip-path's own
// percentages resolve against that element's own border box (14x14px here)
// regardless of ancestor sizing, which a previous width%+overflow:hidden
// wrapper approach turned out not to reliably clip at all.
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
