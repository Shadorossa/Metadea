// Public view of another user's profile — reached from the navbar
// quick-search's "Usuarios" tab (or any /user?id=<userId> link). Same tab
// structure and same components as the local /profile page (HofSection,
// LibrarySection, StatsSection, ReviewsSection, ListsSection,
// ActivitySection) — just fed from the synced social_user_* cache instead
// of the viewer's own local tables, and read-only (no edit/create/delete
// affordances render at all, see each component's own `readOnly` handling).
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
import { useEffect, useMemo, useState } from 'react';
import { getPublicProfile, followUser, unfollowUser, type PublicProfile } from '../../lib/social/users';
import {
  getUserInfo,
  hydrateSocialProfile, getSocialLibrary, getSocialActivity, getSocialLists, getSocialListItems,
  getSocialMonthlyHistory, getAllCharacters, getAllMediaRelations, getSagaNames,
  type LibraryEntry, type MediaCatalogEntry, type CharacterEntry, type DbMediaRelation,
  type DayJourney, type UserJourneyEvent, type ListInfo, type ListItemFull,
} from '../../lib/tauri';
import { getT } from '../../i18n/client';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { toLibraryEntry } from '../../lib/social/social-library-mapping';
import { getNonEditionItems, getItemMinutes } from '../../lib/profile/stats-calculators';
import { buildMonthlyHistoryHtml, initMonthlyHistoryListeners } from '../../lib/profile/monthly';
import { syncActiveRatingSystem, formatAverageScore } from '../../lib/media/rating-utils';
import { pad } from '../../lib/profile/utils';
import {
  ICON_PROFILE_OVERVIEW, ICON_PROFILE_LIBRARY, ICON_PROFILE_FAVORITES,
  ICON_PROFILE_STATS, ICON_PROFILE_REVIEWS, ICON_PROFILE_LISTS,
} from '../../lib/shared/icon-strings';
import { HofSection } from '../profile/HofSection';
import { FavoritesSection } from '../profile/FavoritesSection';
import { LibrarySection } from '../profile/LibrarySection';
import { StatsSection } from '../profile/StatsSection';
import { ReviewsSection } from '../profile/ReviewsSection';
import { ListsSection } from '../profile/ListsSection';
import { ActivitySection } from '../profile/ActivitySection';

const HYDRATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const TABS = ['overview', 'library', 'favorites', 'stats', 'reviews', 'lists'] as const;
type Tab = typeof TABS[number];

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
      status: item.status ?? null,
      progress: item.progress ?? null,
    })),
    profile.activity,
    profile.monthlyHistory,
    profile.lists.map(l => ({ key: l.key, name: l.name, description: l.description, is_fav: l.is_fav, items: l.items })),
  ).catch(() => {});

  localStorage.setItem(lastHydrateKey(userId), String(Date.now()));
}

// Flattens the social activity cache (already event-shaped, each carrying
// its own `date`) into the same day-grouped DayJourney[] structure
// ActivitySection/StatsSection expect from readUserJourney().
function toDayJourney(activity: Array<{
  external_id: string; event_type: string; media_type: string | null;
  date: string | null; timestamp: string; progress_start: number | null; progress_end: number | null;
}>): DayJourney[] {
  const byDate = new Map<string, UserJourneyEvent[]>();
  for (const a of activity) {
    const date = a.date ?? a.timestamp.slice(0, 10);
    const list = byDate.get(date) ?? [];
    list.push({
      externalId: a.external_id,
      type: a.event_type as UserJourneyEvent['type'],
      progressStart: a.progress_start ?? undefined,
      progressEnd: a.progress_end ?? undefined,
      mediaType: a.media_type ?? '',
      timestamp: a.timestamp,
    });
    byDate.set(date, list);
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, events]) => ({ date, events }));
}

interface ProfileData {
  items: LibraryEntry[];
  catalogMap: Map<string, MediaCatalogEntry>;
  characterMap: Map<string, CharacterEntry>;
  sagaRelations: DbMediaRelation[];
  sagaNames: Record<string, string>;
  journey: DayJourney[];
  lists: ListInfo[];
  favorites: Record<string, string[]>;
  monthlyHistory: Record<string, string[]>;
}

function MonthlyHistory({ history, items, catalogMap }: { history: Record<string, string[]>; items: LibraryEntry[]; catalogMap: Map<string, MediaCatalogEntry> }) {
  const html = useMemo(() => buildMonthlyHistoryHtml(history, items, catalogMap), [history, items, catalogMap]);
  return (
    <div
      dangerouslySetInnerHTML={{ __html: html }}
      ref={el => { if (el) initMonthlyHistoryListeners(el); }}
    />
  );
}

function OverviewTab({ data, p }: { data: ProfileData; p: ReturnType<typeof getT>['profile'] }) {
  const { items, catalogMap, characterMap, journey, favorites } = data;
  const [system, setSystem] = useState<'5-star' | '10-dec' | '10' | '3-emoji'>('5-star');
  useEffect(() => { syncActiveRatingSystem().then(setSystem); }, []);

  const hofItems = useMemo(() => (favorites.multimedia ?? []).map(id => {
    const local = items.find(item => item.external_id === id);
    if (local) return local;
    const meta = catalogMap.get(id);
    if (meta) return { external_id: id, type: meta.type } as LibraryEntry;
    return null;
  }).filter((i): i is LibraryEntry => i !== null), [favorites, items, catalogMap]);

  const stats = useMemo(() => {
    const nonEditionItems = getNonEditionItems(items, catalogMap);
    let completed = 0, inProgress = 0, planning = 0, dropped = 0;
    let totalRating = 0, ratedCount = 0, totalMinutes = 0;
    for (const item of nonEditionItems) {
      const s = item.status ?? 'planning';
      if (s === 'completed') completed++;
      else if (s === 'watching' || s === 'reading' || s === 'playing') inProgress++;
      else if (s === 'planning') planning++;
      else if (s === 'dropped') dropped++;
      if (item.rating) { totalRating += item.rating; ratedCount++; }
    }
    for (const item of items) totalMinutes += getItemMinutes(item, catalogMap);
    return {
      total: nonEditionItems.length, completed, inProgress, planning, dropped,
      avg: ratedCount > 0 ? formatAverageScore(totalRating / ratedCount, system) : '0.0',
      hours: Math.round(totalMinutes / 60),
    };
  }, [items, catalogMap, system]);

  return (
    <>
      <HofSection
        items={hofItems}
        catalogMap={catalogMap}
        p={p}
        charFavIds={favorites.character ?? []}
        characterMap={characterMap}
      />
      <div className="profile-stats-bar">
        {([
          [p.stat_total, pad(stats.total)],
          [p.stat_progress, pad(stats.inProgress)],
          [p.stat_completed, pad(stats.completed)],
          [p.stat_pending, pad(stats.planning)],
          [p.stat_dropped, pad(stats.dropped)],
          [p.stat_avg, stats.avg],
          [p.stat_hours, stats.hours + 'h'],
        ] as [string, string][]).map(([label, value]) => (
          <div className="profile-stat" key={label}>
            <span className="profile-stat-value">{value}</span>
            <span className="profile-stat-label">{label}</span>
          </div>
        ))}
      </div>
      <div className="profile-bottom-grid">
        <div className="profile-bottom-col">
          <div className="profile-section-header">
            <p className="profile-section-label">{p.monthly_history}</p>
            <div className="profile-section-line"></div>
          </div>
          <MonthlyHistory history={data.monthlyHistory} items={items} catalogMap={catalogMap} />
        </div>
        <div className="profile-bottom-col">
          <div className="profile-section-header">
            <p className="profile-section-label">{p.recent_activity}</p>
            <div className="profile-section-line"></div>
          </div>
          <ActivitySection catalogMap={catalogMap} p={p} overrideJourney={journey} readOnly />
        </div>
      </div>
    </>
  );
}

export function UserProfileView() {
  const s = getT().social;
  const p = getT().profile;
  const userId = useQueryUserId();
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<ProfileData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
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
      if (!p) return;

      await hydrateIfStale(userId, p);
      if (cancelled) return;

      const [
        socialLibrary, socialActivity, socialLists, socialMonthly,
        { catalog: catalogEntries }, characters, sagaRelations,
      ] = await Promise.all([
        getSocialLibrary(userId).catch(() => []),
        getSocialActivity(userId).catch(() => []),
        getSocialLists(userId).catch(() => []),
        getSocialMonthlyHistory(userId).catch(() => []),
        getCachedLibraryAndCatalog(),
        getAllCharacters().catch(() => []),
        getAllMediaRelations().catch(() => []),
      ]);
      if (cancelled) return;

      const items = socialLibrary.map(toLibraryEntry);
      const catalogMap = new Map(catalogEntries.map(e => [e.external_id, e]));
      const characterMap = new Map(characters.map(c => [c.external_id, c]));
      const sagaNames = await getSagaNames(items.map(i => i.external_id)).catch(() => ({} as Record<string, string>));
      if (cancelled) return;

      const monthlyHistory: Record<string, string[]> = {};
      for (const group of socialMonthly) monthlyHistory[group.month] = group.items.map(i => i.external_id);

      setData({
        items, catalogMap, characterMap, sagaRelations, sagaNames,
        journey: toDayJourney(socialActivity),
        lists: socialLists.map(l => ({ key: l.key, name: l.name, description: l.description, is_fav: l.is_fav, item_count: l.item_count, preview_ids: [] })),
        favorites: p.favorites ?? {},
        monthlyHistory,
      });
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

  const fetchListItems = useMemo(() => async (listKey: string): Promise<ListItemFull[]> => {
    if (!userId) return [];
    const refs = await getSocialListItems(userId, listKey).catch(() => []);
    return refs.map((r, i) => ({
      external_id: r.external_id, position: i, library_id: null, status: null, rating: null,
      progress: 0, progress_2: 0, is_favorite: false, is_platinum: false,
      title_main: r.title_main, cover_url: r.cover_url, media_type: r.media_type, format: null,
    }));
  }, [userId]);

  if (isRedirectingSelf || profile === undefined) return null;

  if (profile === null) {
    return (
      <div className="user-profile-empty">
        <p>{s.user_not_found}</p>
      </div>
    );
  }

  return (
    <>
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

      <div className="profile-tabs-divider">
        <div className="profile-divider-line"></div>
      </div>

      <nav className="profile-tabs">
        <button className={`profile-tab${activeTab === 'overview' ? ' active' : ''}`} data-tooltip={p.tab_overview} onClick={() => setActiveTab('overview')} dangerouslySetInnerHTML={{ __html: ICON_PROFILE_OVERVIEW }} />
        <button className={`profile-tab${activeTab === 'library' ? ' active' : ''}`} data-tooltip={p.tab_library} onClick={() => setActiveTab('library')} dangerouslySetInnerHTML={{ __html: ICON_PROFILE_LIBRARY }} />
        <button className={`profile-tab${activeTab === 'favorites' ? ' active' : ''}`} data-tooltip={p.favorites} onClick={() => setActiveTab('favorites')} dangerouslySetInnerHTML={{ __html: ICON_PROFILE_FAVORITES }} />
        <button className={`profile-tab${activeTab === 'stats' ? ' active' : ''}`} data-tooltip={p.tab_stats} onClick={() => setActiveTab('stats')} dangerouslySetInnerHTML={{ __html: ICON_PROFILE_STATS }} />
        <button className={`profile-tab${activeTab === 'reviews' ? ' active' : ''}`} data-tooltip={p.reviews} onClick={() => setActiveTab('reviews')} dangerouslySetInnerHTML={{ __html: ICON_PROFILE_REVIEWS }} />
        <button className={`profile-tab${activeTab === 'lists' ? ' active' : ''}`} data-tooltip={p.lists} onClick={() => setActiveTab('lists')} dangerouslySetInnerHTML={{ __html: ICON_PROFILE_LISTS }} />
      </nav>

      <div className="profile-tab-content">
        {data === null ? (
          <div className="profile-empty"><p>{p.stats_loading}</p></div>
        ) : (
          <>
            {activeTab === 'overview' && <OverviewTab data={data} p={p} />}
            {activeTab === 'library' && (
              <LibrarySection
                overrideItems={data.items}
                overrideCatalogMap={data.catalogMap}
                overrideSagaRelations={data.sagaRelations}
                overrideSagaNames={data.sagaNames}
                readOnly
              />
            )}
            {activeTab === 'favorites' && (
              <FavoritesSection
                overrideItems={data.items}
                overrideCatalogMap={data.catalogMap}
                overrideCharacterMap={data.characterMap}
                overrideFavData={profile.favorites ?? {}}
                readOnly
              />
            )}
            {activeTab === 'stats' && (
              <StatsSection
                overrideItems={data.items}
                overrideCatalogMap={data.catalogMap}
                overrideJourney={data.journey}
              />
            )}
            {activeTab === 'reviews' && (
              <ReviewsSection overrideItems={data.items} overrideCatalogMap={data.catalogMap} />
            )}
            {activeTab === 'lists' && (
              <ListsSection
                overrideLists={data.lists}
                overrideCatalogMap={data.catalogMap}
                overrideFetchItems={fetchListItems}
                readOnly
              />
            )}
          </>
        )}
      </div>
    </>
  );
}
