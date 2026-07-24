// Once-a-day fetch of the activity feed (people you follow) from
// metadea-web, cached in localStorage — same daily-gate pattern as
// profile-sync.ts. Home reads getCachedActivityFeed() synchronously (no
// network wait) and this refreshes the cache in the background for next time.
import { API_URL } from '../config';
import { getAuthToken } from '../tauri';
import { STORAGE_KEYS } from '../shared/storage-keys';

const FETCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface ActivityFeedEntry {
  userId:    string;
  username:  string;
  avatarUrl: string | null;
  activity:  Array<{
    externalId: string;
    type:       'start' | 'complete' | 'progress';
    mediaType:  string;
    date:       string;
    timestamp:  string;
    progressStart?: number;
    progressEnd?:   number;
  }>;
  updatedAt: string;
}

export function getCachedActivityFeed(): ActivityFeedEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.activityFeedCache);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function refreshActivityFeed(): Promise<void> {
  if (!navigator.onLine) return;

  const session = await getAuthToken().catch(() => null);
  if (!session || session.token === 'offline_token') return;

  const lastFetch = localStorage.getItem(STORAGE_KEYS.activityFeedLastFetch);
  if (lastFetch && Date.now() - parseInt(lastFetch, 10) < FETCH_INTERVAL_MS) return;

  try {
    const res = await fetch(`${API_URL}/api/activity/feed`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return;

    const { entries } = await res.json() as { entries: ActivityFeedEntry[] };
    localStorage.setItem(STORAGE_KEYS.activityFeedCache, JSON.stringify(entries));
    localStorage.setItem(STORAGE_KEYS.activityFeedLastFetch, String(Date.now()));
  } catch (error) {
    console.warn('[ActivityFeed] Refresh failed:', error);
  }
}
