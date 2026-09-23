// User search + public-profile viewing + follow/unfollow — all live calls
// (no daily-cache gate, unlike profile-sync/activity-feed) since these are
// triggered by explicit user actions (search-as-you-type, opening a profile,
// clicking Follow), not something to batch once a day.
import { API_URL } from '../api/urls';
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
  occurrence?: number | null;
}

export interface PublicProfileLibraryItem {
  external_id: string;
  rating?: number | null;
  started_at?: string | null;
  finished_at?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  status?: string | null;
  progress?: number | null;
  // Profile-parity fields (absent on a profile an older app synced).
  rating_2?: number | null;
  progress_2?: number | null;
  minutes_spent?: number | null;
  reconsumption_count?: number | null;
  reconsuming?: number | null;
}

/** How the owner shows their second rating — see DualRatingPayload in
 *  profile-sync-payload.ts; null when they don't use one. */
export interface PublicDualRating {
  name_1: string | null;
  name_2: string | null;
  system_2: '5-star' | '10-dec' | '10' | '3-emoji';
  min_2: number;
  max_2: number;
}

export interface PublicProfileList {
  key: string;
  name: string;
  description: string;
  is_fav: boolean;
  items: string[];
}

/** One synced character reaction — see CharacterReactionPayloadEntry. */
export interface PublicCharacterReactionEntry {
  external_id: string;
  name?: string | null;
  image_url?: string | null;
}

export interface PublicCharacterReactions {
  like?: PublicCharacterReactionEntry[];
  interest?: PublicCharacterReactionEntry[];
  dislike?: PublicCharacterReactionEntry[];
}

/** One synced bingo cell — see BingoPayloadCell in profile-sync-payload.ts. */
export interface PublicBingoCell {
  external_id: string;
  title: string;
  cover_url: string | null;
  media_type: string;
}

/** One synced Yearly Bingo board — see BingoPayloadYear. */
export interface PublicBingoYear {
  year: number;
  /** 1–49 (absent on boards synced before sizes existed: 16). */
  size?: number;
  cells: (PublicBingoCell | null)[];
  /** The owner's result, only once the board is in its result phase. */
  result?: { completed: boolean[]; scores: (number | null)[] } | null;
}

export interface PublicProfile {
  userId: string;
  username: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  bio: string | null;
  library: PublicProfileLibraryItem[];
  /** The 30 latest completions (what the activity feed shows). */
  activity: PublicProfileActivityEvent[];
  monthlyHistory: Record<string, string[]>;
  lists: PublicProfileList[];
  /** Hall of Fame picks — { multimedia: string[], character: string[] } (same shape lib/tauri/favorites.ts's readUserFavorites returns for the viewer's own). */
  favorites: Record<string, string[]>;
  // Profile-parity fields — optional because an older Worker omits them,
  // and empty until the owner's app syncs once with a version that sends
  // them.
  /** Display-name font id (Settings > Perfil). */
  nameFont?: string | null;
  /** Every journey kind (start / progress / complete), last 365 days. */
  journey?: PublicProfileActivityEvent[];
  /** external_id -> the owner's chosen cover URL. */
  coverPreferences?: Record<string, string>;
  dualRating?: PublicDualRating | null;
  /** Like / interest / dislike character lists; null/absent = not shared. */
  characterReactions?: PublicCharacterReactions | null;
  /** Yearly Bingo boards, newest year first; null/absent = not shared. */
  bingo?: PublicBingoYear[] | null;
  updatedAt: string | null;
  /** Their metadea.pages.dev/u/<id> page is served; absent (older Worker) = unknown, treated as private. */
  webProfilePublic?: boolean;
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

// The caller's own followers/following lists — always the signed-in user,
// not a :userId param (see the backend route's own doc comment for why).
export async function getFollowers(): Promise<UserSearchResult[]> {
  const headers = await authHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/api/follows/followers`, { headers });
  if (!res.ok) return [];
  const { results } = await res.json() as { results: UserSearchResult[] };
  return results;
}

export async function getFollowing(): Promise<UserSearchResult[]> {
  const headers = await authHeaders();
  if (!headers) return [];
  const res = await fetch(`${API_URL}/api/follows/following`, { headers });
  if (!res.ok) return [];
  const { results } = await res.json() as { results: UserSearchResult[] };
  return results;
}

export interface FollowPage {
  results: UserSearchResult[];
  /** Everyone in the list (public profiles only), not just this page. */
  total: number;
  /** Pass back to fetch the next page; null on the last one. */
  nextCursor: string | null;
}

const FOLLOW_PAGE_SIZE = 60;

// Someone else's followers / following, one page at a time. null when the
// list can't be read (signed out, not a public profile, an older Worker
// without the route) — the Friends tab then says so instead of claiming the
// profile has nobody.
export async function getUserFollowPage(
  userId: string,
  direction: 'followers' | 'following',
  cursor: string | null = null,
): Promise<FollowPage | null> {
  const headers = await authHeaders();
  if (!headers) return null;
  const params = new URLSearchParams({ limit: String(FOLLOW_PAGE_SIZE) });
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`${API_URL}/api/follows/${encodeURIComponent(userId)}/${direction}?${params}`, { headers });
  if (!res.ok) return null;
  return res.json() as Promise<FollowPage>;
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
