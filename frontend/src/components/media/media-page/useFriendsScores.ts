import { useEffect, useState } from 'react';
import { fetchFollowedFriendsScores, type FriendScore } from '../../../lib/anilist/friends';
import { ANILIST_TYPES } from '../../../lib/media/media-types';

// "Usuarios" (followed AniList friends' own scores for this exact entry)
// only needs the numeric id from the URL — not any of the media data
// itself — so it's fired here in parallel with the main fetch instead of
// nested inside the `full` callback below, where it used to wait on the
// live/catalog fetch to fully resolve first even though it has no real
// dependency on that data.
export function useFriendsScores(currentId: string, previewMode: boolean) {
  const [friendsScores,      setFriendsScores]      = useState<FriendScore[]>([]);
  const [friendsLoading,     setFriendsLoading]     = useState(false);

  useEffect(() => {
    if (previewMode) return;
    if (!currentId) return;

    let cancelled = false;

    const [currentType, currentNumericIdStr] = currentId.split(':');
    if ((ANILIST_TYPES as readonly string[]).includes(currentType)) {
      const anilistId = parseInt(currentNumericIdStr, 10);
      if (anilistId) {
        setFriendsLoading(true);
        fetchFollowedFriendsScores(anilistId).then(scores => {
          if (!cancelled) setFriendsScores(scores);
        }).catch(() => {}).finally(() => {
          if (!cancelled) setFriendsLoading(false);
        });
      }
    }

    return () => { cancelled = true; };
  }, [currentId, previewMode]);

  return { friendsScores, friendsLoading };
}
