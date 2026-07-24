// Once-a-day upload of the current user's public snapshot (bio, rating
// system, theme, recent activity) to the metadea-web server — same pattern
// as syncCommunityCatalog in BaseLayout.astro (localStorage timestamp gate,
// called once per app session with a short delay). Only runs for a real
// Google-linked session; the local "offline_token" mode has no server
// identity to sync to.
import { API_URL } from '../config';
import { getAuthToken, getUserInfo, readUserJourney } from '../tauri';
import { STORAGE_KEYS } from '../shared/storage-keys';

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVITY_ENTRIES = 30;

// Flattens the day-grouped journey into a single recency-sorted list — the
// feed just needs "what happened, when", not the day-bucket structure the
// local Profile page's calendar view uses it for.
async function compileRecentActivity(): Promise<unknown[]> {
  const journey = await readUserJourney().catch(() => []);
  const flat = journey.flatMap(day =>
    day.events.map(event => ({ date: day.date, ...event }))
  );
  flat.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return flat.slice(0, MAX_ACTIVITY_ENTRIES);
}

export async function syncProfileToServer(): Promise<void> {
  if (!navigator.onLine) return;

  const session = await getAuthToken().catch(() => null);
  if (!session || session.token === 'offline_token') return;

  const lastSync = localStorage.getItem(STORAGE_KEYS.profileSyncLastSync);
  if (lastSync && Date.now() - parseInt(lastSync, 10) < SYNC_INTERVAL_MS) return;

  try {
    const [info, activity] = await Promise.all([
      getUserInfo().catch(() => ({} as Record<string, unknown>)),
      compileRecentActivity(),
    ]);

    const res = await fetch(`${API_URL}/api/profile/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        bio: (info.bio as string | undefined) ?? null,
        rating_system: localStorage.getItem(STORAGE_KEYS.ratingSystem),
        theme: localStorage.getItem(STORAGE_KEYS.appTheme),
        activity,
      }),
    });

    if (res.ok) {
      localStorage.setItem(STORAGE_KEYS.profileSyncLastSync, String(Date.now()));
    }
  } catch (error) {
    console.warn('[ProfileSync] Failed:', error);
  }
}
