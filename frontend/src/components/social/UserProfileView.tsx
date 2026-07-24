// Public view of another user's profile — reached from the navbar
// quick-search's "Usuarios" tab (or any /user?id=<userId> link). Shows what
// they've chosen to sync (banner/avatar/bio/library snapshot) plus a
// Follow/Unfollow toggle. Library items only ever resolve a title/cover
// against the VIEWER's own local catalog — same "you only see what you
// already know" privacy model the activity feed uses.
import { useEffect, useState } from 'react';
import { getPublicProfile, followUser, unfollowUser, type PublicProfile } from '../../lib/social/users';
import { getCatalogEntry, wrapAssetUrl } from '../../lib/tauri';
import { getT } from '../../i18n/client';

function useQueryUserId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('id'));
  }, []);
  return id;
}

interface ResolvedLibraryItem {
  externalId: string;
  title: string;
  cover: string | null;
}

export function UserProfileView() {
  const s = getT().social;
  const userId = useQueryUserId();
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resolvedLibrary, setResolvedLibrary] = useState<ResolvedLibraryItem[]>([]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getPublicProfile(userId).then(p => {
      if (cancelled) return;
      setProfile(p);
      setFollowing(p?.isFollowing ?? false);
    });
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    Promise.all(
      profile.library.map(async item => {
        const entry = await getCatalogEntry(item.external_id).catch(() => null);
        if (!entry?.title_main) return null;
        return { externalId: item.external_id, title: entry.title_main, cover: entry.cover_url ?? null };
      })
    ).then(results => {
      if (cancelled) return;
      setResolvedLibrary(results.filter((r): r is ResolvedLibraryItem => r !== null));
    });
    return () => { cancelled = true; };
  }, [profile]);

  async function toggleFollow() {
    if (!profile || busy) return;
    setBusy(true);
    const ok = following ? await unfollowUser(profile.userId) : await followUser(profile.userId);
    if (ok) setFollowing(f => !f);
    setBusy(false);
  }

  if (profile === undefined) return null;

  if (profile === null) {
    return (
      <div className="user-profile-empty">
        <p>{s.user_not_found}</p>
      </div>
    );
  }

  return (
    <div className="user-profile-view">
      <div className="profile-banner" style={profile.bannerUrl ? { backgroundImage: `url('${profile.bannerUrl}')`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
        <div className="profile-banner-content">
          {profile.avatarUrl
            ? <img className="profile-avatar" src={profile.avatarUrl} alt={profile.username} referrerPolicy="no-referrer" />
            : <div className="profile-avatar-placeholder">{(profile.username[0] ?? '?').toUpperCase()}</div>}
          <h1 className="profile-username-large">{profile.username}</h1>
        </div>
      </div>

      <div className="user-profile-body">
        {!profile.isSelf && (
          <button
            type="button"
            className={`user-profile-follow-btn${following ? ' active' : ''}`}
            onClick={toggleFollow}
            disabled={busy}
          >
            {following ? s.unfollow : s.follow}
          </button>
        )}

        {profile.bio && <p className="user-profile-bio">{profile.bio}</p>}

        {resolvedLibrary.length === 0 ? (
          <p className="user-profile-library-empty">{s.library_empty}</p>
        ) : (
          <div className="user-profile-library-grid">
            {resolvedLibrary.map(item => (
              <a
                key={item.externalId}
                className="user-profile-library-item"
                href={`/media?id=${encodeURIComponent(item.externalId)}`}
                title={item.title}
              >
                {item.cover
                  ? <img className="user-profile-library-cover" src={wrapAssetUrl(item.cover)} alt="" loading="lazy" />
                  : <div className="user-profile-library-cover user-profile-library-cover--empty" />}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
