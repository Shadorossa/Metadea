// "Amigos" tab on the profile page — who follows you and who you follow.
// Both lists come from the caller's own account (no :userId param — see the
// backend route's own doc comment), so this never needs to know whose
// profile it's showing.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getFollowers, getFollowing, unfollowUser, type UserSearchResult } from '../../lib/social/users';
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

export function FriendsSection() {
  const p = getT().profile;
  const [tab, setTab] = useState<'followers' | 'following'>('followers');
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
