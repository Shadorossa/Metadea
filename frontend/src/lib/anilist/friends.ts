import { getAniListToken } from '../tauri';
import { API_ENDPOINTS } from '../api/endpoints';
import { graphqlPost } from '../api/client';
import { sessionCacheGet, sessionCacheSet } from '../cache/session-ttl-cache';

// AniList's own site uses this exact query shape ("who I follow has scored
// this") — Page.mediaList's isFollowing filter resolves relative to the
// authenticated viewer, so it needs the user's own AniList token (the same
// one already used for library sync/import), not just a client id/secret.
// score(format: POINT_100) forces a normalized 0-100 value regardless of
// each individual friend's own AniList scoring-format preference (POINT_10,
// POINT_5, POINT_3, ...) — the plain `score` field returns in whatever
// format the list OWNER uses, which would make friends' scores inconsistent
// with each other and impossible to convert reliably into this app's own
// rating system. Viewer.id is fetched alongside so the logged-in user's own
// entry (isFollowing:true can include your own list depending on AniList's
// resolution — better to filter it explicitly than assume) is excluded.
const FRIENDS_SCORES_QUERY = `
query FriendsScores($mediaId: Int) {
  Viewer { id }
  Page(perPage: 50) {
    mediaList(mediaId: $mediaId, isFollowing: true, sort: SCORE_DESC) {
      score(format: POINT_100)
      user { id name avatar { medium } }
    }
  }
}`;

export interface FriendScore {
  name: string;
  avatar: string | null;
  /** Always 0-100 (see the query's score(format: POINT_100)) — convert to
   *  this app's own 0-10 DB scale (÷10) before formatting with rating-utils. */
  score: number;
  /** This user's own AniList profile page. */
  profileUrl: string;
}

interface FriendsScoresResponse {
  Viewer: { id: number } | null;
  Page: {
    mediaList: Array<{
      score: number;
      user: { id: number; name: string; avatar: { medium: string | null } | null };
    }>;
  };
}

// sessionStorage (not just an in-memory Map) — an F5 reloads the whole
// webview, which would otherwise reset any in-memory cache along with it.
// This survives that reload but not a full app restart, same tradeoff as
// media-cache.ts's own page-data cache.
const TTL_MS = 10 * 60 * 1000;
const CACHE_PREFIX = 'anilist_friends_scores_v1:';

// Returns [] (not an error) whenever this genuinely can't be shown — no
// token connected, request failure, or nobody followed has scored it — so
// callers can just skip rendering the section rather than handle a
// separate error state for what's an optional, best-effort feature.
export async function fetchFollowedFriendsScores(mediaId: number): Promise<FriendScore[]> {
  const cached = sessionCacheGet<FriendScore[]>(CACHE_PREFIX, mediaId);
  if (cached) return cached;

  const token = getAniListToken();
  if (!token) return [];

  const { ok, result } = await graphqlPost<FriendsScoresResponse>(
    API_ENDPOINTS.ANILIST, FRIENDS_SCORES_QUERY, { mediaId }, { token },
  );
  if (!ok || result?.errors) return [];

  const viewerId = result?.data?.Viewer?.id;

  const scores = (result?.data?.Page?.mediaList ?? [])
    .filter(entry => entry.score > 0 && entry.user.id !== viewerId)
    .map(entry => ({
      name: entry.user.name,
      avatar: entry.user.avatar?.medium ?? null,
      score: entry.score,
      profileUrl: `https://anilist.co/user/${entry.user.name}`,
    }));

  sessionCacheSet(CACHE_PREFIX, mediaId, scores, TTL_MS);
  return scores;
}
