// User search + public-profile viewing + follow/unfollow — all live calls
// (no daily-cache gate, unlike profile-sync/activity-feed) since these are
// triggered by explicit user actions (search-as-you-type, opening a profile,
// clicking Follow), not something to batch once a day.
import { API_URL } from '../config';
import { getAuthToken } from '../tauri';

export interface UserSearchResult {
  userId: string;
  username: string;
  avatarUrl: string | null;
}

export interface PublicProfileActivityEvent {
  externalId: string;
  type: string;
  mediaType?: string | null;
  date?: string | null;
  timestamp: string;
  progressStart?: number | null;
  progressEnd?: number | null;
}

export interface PublicProfileList {
  key: string;
  name: string;
  description: string;
  is_fav: boolean;
  items: string[];
}

export interface PublicProfile {
  userId: string;
  username: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  library: Array<{ external_id: string; rating?: number | null; started_at?: string | null; finished_at?: string | null; notes?: string | null; tags?: string | null }>;
  activity: PublicProfileActivityEvent[];
  monthlyHistory: Record<string, string[]>;
  lists: PublicProfileList[];
  updatedAt: string | null;
  isFollowing: boolean;
  isSelf: boolean;
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const session = await getAuthToken().catch(() => null);
  if (!session || session.token === 'offline_token') return null;
  return { Authorization: `Bearer ${session.token}` };
}

export async function searchUsers(query: string, signal: AbortSignal): Promise<UserSearchResult[]> {
  const headers = await authHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/api/users/search?q=${encodeURIComponent(query)}`, { headers, signal });
  if (!res.ok) return [];
  const { results } = await res.json() as { results: UserSearchResult[] };
  return results;
}

export async function getPublicProfile(userId: string): Promise<PublicProfile | null> {
  const headers = await authHeaders();
  if (!headers) return null;
  const res = await fetch(`${API_URL}/api/profile/${encodeURIComponent(userId)}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

export async function followUser(userId: string): Promise<boolean> {
  const headers = await authHeaders();
  if (!headers) return false;
  const res = await fetch(`${API_URL}/api/follows/${encodeURIComponent(userId)}`, { method: 'POST', headers });
  return res.ok;
}

export async function unfollowUser(userId: string): Promise<boolean> {
  const headers = await authHeaders();
  if (!headers) return false;
  const res = await fetch(`${API_URL}/api/follows/${encodeURIComponent(userId)}`, { method: 'DELETE', headers });
  return res.ok;
}
