// Public view of another user's profile — reached from the navbar
// quick-search's "Usuarios" tab (or any /user?id=<userId> link). Shows what
// they've chosen to sync (banner/avatar/bio/library) plus a Follow/Unfollow
// toggle.
//
// Rendering reads from the LOCAL social_user_* tables (see
// src-tauri/src/social_profile.rs), never straight from the fetched JSON —
// hydrateSocialProfile() writes the server snapshot into them at most once a
// day per visited profile (gated below), so opening a profile you already
// looked at today doesn't re-fetch/re-write anything. Every entry renders
// regardless of whether YOUR OWN media_catalog recognizes it — your catalog
// is what resolves title/cover (or not), it's never a filter on what's
// shown. An unresolved entry falls back to its bare external_id
// ("anime:12345") until your own catalog catches up, at which point the
// exact same cached row resolves correctly next render.
import { useEffect, useState } from 'react';
import { getPublicProfile, followUser, unfollowUser, type PublicProfile } from '../../lib/social/users';
import {
  wrapAssetUrl, getUserInfo,
  hydrateSocialProfile, getSocialLibrary, type SocialLibraryItem,
} from '../../lib/tauri';
import { getT } from '../../i18n/client';

const HYDRATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function lastHydrateKey(userId: string): string {
  return `metadea_social_profile_sync_${userId}`;
}

async function goToOwnProfile(): Promise<void> {
  const { navigate } = await import('astro:transitions/client');
  navigate('/profile');
}

function useQueryUserId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    setId(new URLSearchParams(window.location.search).get('id'));
  }, []);
  return id;
}

// Re-hydrates the local social_user_* cache for this profile at most once a
// day — visiting 900 profiles doesn't mean 900 daily server round trips,
// only the ones you actually open again after the gate expires.
async function hydrateIfStale(userId: string, profile: PublicProfile): Promise<void> {
  const last = localStorage.getItem(lastHydrateKey(userId));
  if (last && Date.now() - parseInt(last, 10) < HYDRATE_INTERVAL_MS) return;

  await hydrateSocialProfile(
    userId,
    profile.library.map(item => ({
      external_id: item.external_id,
      rating: item.rating ?? null,
      started_at: item.started_at ?? null,
      finished_at: item.finished_at ?? null,
      notes: item.notes ?? null,
      tags: item.tags ?? null,
    })),
    profile.activity,
    profile.monthlyHistory,
    profile.lists.map(l => ({ key: l.key, name: l.name, description: l.description, is_fav: l.is_fav, items: l.items })),
  ).catch(() => {});

  localStorage.setItem(lastHydrateKey(userId), String(Date.now()));
}

export function UserProfileView() {
  const s = getT().social;
  const userId = useQueryUserId();
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<SocialLibraryItem[]>([]);
  const [isRedirectingSelf, setIsRedirectingSelf] = useState(false);

  // Your own profile is never read from Turso — it's your real, always-local
  // /profile page (full library editor, stats, etc.), not the read-only
  // Turso snapshot other users get. server_user_id is cached locally by
  // profile-sync.ts, so this redirect fires without waiting on any network
  // call.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getUserInfo().then(info => {
      if (cancelled) return;
      if (info.server_user_id === userId) {
        setIsRedirectingSelf(true);
        goToOwnProfile();
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [userId]);

  useEffect(() => {
    if (!userId || isRedirectingSelf) return;
    let cancelled = false;
    getPublicProfile(userId).then(async p => {
      if (cancelled) return;
      // Fallback for the rare case the local server_user_id cache wasn't
      // ready yet (e.g. right after linking Google, before the first
      // profile-sync ran) — the server itself also knows this is you.
      if (p?.isSelf) {
        setIsRedirectingSelf(true);
        goToOwnProfile();
        return;
      }
      setProfile(p);
      setFollowing(p?.isFollowing ?? false);
      if (p) {
        await hydrateIfStale(userId, p);
        if (cancelled) return;
        setLibrary(await getSocialLibrary(userId).catch(() => []));
      }
    });
    return () => { cancelled = true; };
  }, [userId, isRedirectingSelf]);

  async function toggleFollow() {
    if (!profile || busy) return;
    setBusy(true);
    const ok = following ? await unfollowUser(profile.userId) : await followUser(profile.userId);
    if (ok) setFollowing(f => !f);
    setBusy(false);
  }

  if (isRedirectingSelf || profile === undefined) return null;

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
        </div>
      </div>

      <div className="user-profile-body">
        {profile.bio && <p className="user-profile-bio">{profile.bio}</p>}

        {library.length === 0 ? (
          <p className="user-profile-library-empty">{s.library_empty}</p>
        ) : (
          <div className="user-profile-library-grid">
            {library.map(item => (
              <a
                key={item.external_id}
                className="user-profile-library-item"
                href={`/media?id=${encodeURIComponent(item.external_id)}`}
                title={item.title_main ?? item.external_id}
              >
                {item.cover_url
                  ? <img className="user-profile-library-cover" src={wrapAssetUrl(item.cover_url)} alt="" loading="lazy" />
                  : <div className="user-profile-library-cover user-profile-library-cover--empty" />}
                {!item.title_main && (
                  <span className="user-profile-library-item-fallback">{item.external_id}</span>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
