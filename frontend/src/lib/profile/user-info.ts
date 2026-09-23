import { getUserInfo } from '../tauri/steam';
import { getActiveRatingSystem, type RatingSystem } from '../media/rating-utils';
import { STORAGE_KEYS } from '../storage/storage-keys';

// One get_user_info round trip per page visit, shared by everything on the
// Profile page that reads the user_profile row (display name/font in
// profile.astro, the rating-system sync every tab runs, the Lists tab's
// username). Scoped to the current page: dropped on every ClientRouter
// navigation so a change saved in Settings is picked up the next time the
// profile is opened, exactly as when each caller fetched its own copy.
let userInfoCache: Promise<Record<string, unknown>> | null = null;

export function getCachedUserInfo(): Promise<Record<string, unknown>> {
  if (!userInfoCache) {
    userInfoCache = getUserInfo().catch(() => ({} as Record<string, unknown>));
  }
  return userInfoCache;
}

export function invalidateCachedUserInfo(): void {
  userInfoCache = null;
}

// Same resolution as rating-utils' syncActiveRatingSystem (DB value, else
// the localStorage cache, else the default) and the same localStorage
// refresh, but fed from the shared read above instead of its own
// get_user_info call.
export async function syncActiveRatingSystemFromCachedInfo(): Promise<RatingSystem> {
  if (typeof window === 'undefined') return '5-star';
  const info = await getCachedUserInfo();
  const system = (info.rating_system as RatingSystem) || getActiveRatingSystem();
  localStorage.setItem(STORAGE_KEYS.ratingSystem, system);
  return system;
}

if (typeof document !== 'undefined') {
  document.addEventListener('astro:after-swap', invalidateCachedUserInfo);
}
