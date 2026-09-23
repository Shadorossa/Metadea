// "Amigos" tab on the profile page — who follows you and who you follow
// (your own account's lists, with unfollow), or, on someone else's profile,
// their public followers/following (GET /api/follows/:userId/…, paged).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getFollowers, getFollowing, getUserFollowPage, unfollowUser, type FollowPage, type UserSearchResult,
} from '../../lib/social/users';
import { getT } from '../../i18n/runtime';
import { beginGlobalLoading } from '../../lib/dom/global-loading';
import { IconX } from '../local/ui/icons';

// Instagram-story-style bubble: a circular photo with a ring around it, the
// name sitting below rather than beside it — not the same "row" card the
// rest of the profile page's lists use. Unfollow is an X overlaid on the
// photo's own corner (same spot Instagram/most apps put a "remove" control
// on an avatar bubble), not a separate text button underneath.
function UserCard({ user, onUnfollow, unfollowLabel }: {
  user: UserSearchResult;
  onUnfollow?: () => void;
  unfollowLabel?: string;
}) {
  return (
    <div className="friend-card">
      <a className="friend-card-link" href={`/user?id=${encodeURIComponent(user.userId)}`}>
        <div className="friend-card-avatar-wrap">
          {user.avatarUrl
            ? <img className="friend-card-avatar" src={user.avatarUrl} alt="" referrerPolicy="no-referrer" />
            : <div className="friend-card-avatar friend-card-avatar--placeholder">{(user.username[0] ?? '?').toUpperCase()}</div>}
        </div>
        <span className="friend-card-name">{user.username}</span>
      </a>
      {onUnfollow && (
        <button type="button" className="friend-card-unfollow" onClick={onUnfollow} title={unfollowLabel} aria-label={unfollowLabel}>
          <IconX size={11} strokeWidth={3} />
        </button>
      )}
    </div>
  );
}

function FriendsList({ users, emptyText, children }: {
  users: UserSearchResult[];
  emptyText: string;
  children: (user: UserSearchResult) => ReactNode;
}) {
  if (users.length === 0) {
    return <div className="friends-empty-state"><p>{emptyText}</p></div>;
  }
  return (
    <div className="friends-grid">
      {users.map(u => <div key={u.userId}>{children(u)}</div>)}
    </div>
  );
}

type Direction = 'followers' | 'following';

interface LoadedPage {
  users: UserSearchResult[];
  total: number;
  nextCursor: string | null;
}

/** Someone else's profile (`readOnly` + their `userId`): their public
 *  followers/following, a page at a time. Without a userId the tab shows
 *  the unavailable state. */
export function FriendsSection({ readOnly, userId }: { readOnly?: boolean; userId?: string | null } = {}) {
  if (readOnly) return <PublicFriends userId={userId ?? null} />;
  return <OwnFriends />;
}

function PublicFriends({ userId }: { userId: string | null }) {
  const p = getT().profile;
  const [tab, setTab] = useState<Direction>('followers');
  // undefined = still loading; a null list = the server couldn't serve it.
  const [pages, setPages] = useState<Record<Direction, LoadedPage | null> | undefined>(userId ? undefined : { followers: null, following: null });
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const endLoading = beginGlobalLoading();
    const toPage = (page: FollowPage | null): LoadedPage | null =>
      page && { users: page.results, total: page.total, nextCursor: page.nextCursor };
    Promise.all([
      getUserFollowPage(userId, 'followers').catch(() => null),
      getUserFollowPage(userId, 'following').catch(() => null),
    ])
      .then(([followers, following]) => {
        if (!cancelled) setPages({ followers: toPage(followers), following: toPage(following) });
      })
      .finally(endLoading);
    return () => { cancelled = true; };
  }, [userId]);

  const loadMore = async () => {
    const current = pages?.[tab];
    if (!userId || !current?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    const next = await getUserFollowPage(userId, tab, current.nextCursor).catch(() => null);
    setLoadingMore(false);
    if (!next) return;
    setPages(prev => prev && {
      ...prev,
      [tab]: { users: [...(prev[tab]?.users ?? []), ...next.results], total: next.total, nextCursor: next.nextCursor },
    });
  };

  if (!pages) return <div className="friends-layout" />;
  if (!pages.followers && !pages.following) {
    return (
      <div className="friends-layout">
        <div className="friends-empty-state"><p>{p.friends_unavailable}</p></div>
      </div>
    );
  }

  const current = pages[tab];
  return (
    <div className="friends-layout">
      <div className="friends-tabs">
        {(['followers', 'following'] as const).map(direction => (
          <button
            key={direction}
            type="button"
            className={`friends-tab${tab === direction ? ' active' : ''}`}
            onClick={() => setTab(direction)}
          >
            {direction === 'followers' ? p.friends_followers : p.friends_following}
            {' '}<span className="friends-tab-count">{pages[direction]?.total ?? 0}</span>
          </button>
        ))}
      </div>

      {current ? (
        <>
          <FriendsList
            users={current.users}
            emptyText={tab === 'followers' ? p.friends_empty_followers_other : p.friends_empty_following_other}
          >
            {user => <UserCard user={user} />}
          </FriendsList>
          {current.nextCursor && (
            <div className="friends-load-more-row">
              <button type="button" className="friends-load-more-btn" onClick={loadMore} disabled={loadingMore}>
                {p.friends_load_more}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="friends-empty-state"><p>{p.friends_unavailable}</p></div>
      )}
    </div>
  );
}

function OwnFriends() {
  const p = getT().profile;
  const [tab, setTab] = useState<Direction>('followers');
  const [followers, setFollowers] = useState<UserSearchResult[]>([]);
  const [following, setFollowing] = useState<UserSearchResult[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const endLoading = beginGlobalLoading();
    Promise.all([getFollowers(), getFollowing()])
      .then(([followersResult, followingResult]) => {
        if (cancelled) return;
        setFollowers(followersResult);
        setFollowing(followingResult);
        setLoaded(true);
      })
      .finally(endLoading);
    return () => { cancelled = true; };
  }, []);

  const handleUnfollow = async (userId: string) => {
    setFollowing(prev => prev.filter(u => u.userId !== userId));
    await unfollowUser(userId).catch(() => {
      // Failed server-side — the list already dropped it locally, but a
      // stale re-fetch (tab revisit) would just show it again, same as any
      // other optimistic-update rollback-by-refetch in this app.
    });
  };

  return (
    <div className="friends-layout">
      <div className="friends-tabs">
        <button
          type="button"
          className={`friends-tab${tab === 'followers' ? ' active' : ''}`}
          onClick={() => setTab('followers')}
        >
          {p.friends_followers} <span className="friends-tab-count">{followers.length}</span>
        </button>
        <button
          type="button"
          className={`friends-tab${tab === 'following' ? ' active' : ''}`}
          onClick={() => setTab('following')}
        >
          {p.friends_following} <span className="friends-tab-count">{following.length}</span>
        </button>
      </div>

      {loaded && (
        tab === 'followers' ? (
          <FriendsList users={followers} emptyText={p.friends_empty_followers}>
            {user => <UserCard user={user} />}
          </FriendsList>
        ) : (
          <FriendsList users={following} emptyText={p.friends_empty_following}>
            {user => (
              <UserCard
                user={user}
                unfollowLabel={p.friends_unfollow}
                onUnfollow={() => handleUnfollow(user.userId)}
              />
            )}
          </FriendsList>
        )
      )}
    </div>
  );
}
