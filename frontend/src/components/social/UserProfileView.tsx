// Public view of another user's profile — reached from the navbar
// quick-search's "Usuarios" tab (or any /user?id=<userId> link). Same page
// format as the local /profile page: the same banner, the same tabs in the
// same order (Bingo only when they synced a board), the same
// `.profile-tab-pane`s kept mounted once visited,
// and every tab body is the owner's own section component (OverviewSection,
// LibrarySection, FavoritesSection, StatsSection, ReviewsSection,
// ListsSection, FriendsSection; BingoPublicSection read-only) fed injected
// data with `readOnly` instead of its own local fetch. Only the Follow and taste-compatibility buttons are
// specific to this page.
//
// Rendering reads from the LOCAL social_user_* tables (see
// src-tauri/src/social_profile.rs), never straight from the fetched JSON —
// hydrateSocialProfile() writes the server snapshot into them at most once a
// day per visited profile (gated below), so opening a profile you already
// looked at today doesn't re-fetch/re-write anything. Every entry renders
// regardless of whether YOUR OWN media_catalog recognizes it — your catalog
// is what resolves title/cover (or not), it's never a filter on what's
// shown. The Bingo tab is the exception: it renders the fetched boards
// directly (each cell carries its own title/cover snapshot and the owner's
// result). An unresolved entry falls back to its bare external_id
// ("anime:12345") until your own catalog catches up, at which point the
// exact same cached row resolves correctly next render.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link as LinkIcon, UserMinus, UserPlus } from 'lucide-react';
import { useHydrated } from '../shared/hooks/useHydrated';
import { getPublicProfile, followUser, unfollowUser, type PublicProfile } from '../../lib/social/users';
import {
  getUserInfo,
  hydrateSocialProfile, getSocialLibraryLight, getSocialActivityLight, getSocialLists, getSocialListItemsLight,
  getSocialMonthlyHistoryLight, getAllCharactersLight, getCatalogEntriesByIds, getSagaNames, getTasteCompatibility,
  getSocialCharacterReactions, emptyCharacterReactionGroups,
  type CatalogSummary, type ListInfo, type ListItemFull,
} from '../../lib/tauri';
import { getT } from '../../i18n/runtime';
import { copyWebProfileLink } from '../../lib/social/web-profile-link';
import { loadScopedMediaRelations } from '../../lib/profile/relations-scope';
import { toLibraryEntry } from '../../lib/social/social-library-mapping';
import {
  toSocialLibraryInputs, toSocialActivityInputs, toSocialCharacterReactionsInput,
  toDayJourney, applyOwnerCovers, toPublicBingoBoards,
} from '../../lib/social/public-profile-mapping';
import { interpolate } from '../../lib/shared/text/interpolate';
import { getFontFile } from '../settings/mount/fonts';
import { computeTasteCompatibility, hoursByMedium, librarySignals, type TasteCompatibility } from '../../lib/social/taste-compatibility';
import { syncActiveRatingSystemFromCachedInfo } from '../../lib/profile/user-info';
import { getCachedLibraryAndCatalog } from '../../lib/profile/library-data-cache';
import { resolveCachedCoverPaths } from '../../lib/profile/cover-cache';
import { beginGlobalLoading } from '../../lib/dom/global-loading';
import {
  ICON_PROFILE_OVERVIEW, ICON_PROFILE_LIBRARY, ICON_PROFILE_FAVORITES,
  ICON_PROFILE_STATS, ICON_PROFILE_REVIEWS, ICON_PROFILE_LISTS, ICON_PROFILE_BINGO, ICON_PROFILE_FRIENDS,
} from '../../lib/dom/icon-strings';
import { OverviewSection, overviewCoverIds, type OverviewData } from '../profile/OverviewSection';
import { FavoritesSection } from '../profile/FavoritesSection';
import { LibrarySection } from '../profile/LibrarySection';
import { StatsSection } from '../profile/StatsSection';
import { ReviewsSection } from '../profile/ReviewsSection';
import { ListsSection } from '../profile/ListsSection';
import { FriendsSection } from '../profile/FriendsSection';
import { BingoPublicSection } from '../bingo/BingoPublicSection';
import { TasteHeartButton } from './TasteCompatibility';

const HYDRATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Same order as profile.astro; 'bingo' is only shown when the profile
// synced a board (see visibleTabs).
const TABS = ['overview', 'library', 'favorites', 'stats', 'reviews', 'lists', 'bingo', 'friends'] as const;
type Tab = typeof TABS[number];

const TAB_ICONS: Record<Tab, string> = {
  overview: ICON_PROFILE_OVERVIEW,
  library: ICON_PROFILE_LIBRARY,
  favorites: ICON_PROFILE_FAVORITES,
  stats: ICON_PROFILE_STATS,
  reviews: ICON_PROFILE_REVIEWS,
  lists: ICON_PROFILE_LISTS,
  bingo: ICON_PROFILE_BINGO,
  friends: ICON_PROFILE_FRIENDS,
};

// Same tooltip keys as profile.astro's tab strip; `bingoYear` is the newest
// synced board's year.
function tabTooltip(tab: Tab, p: ReturnType<typeof getT>['profile'], bingoYear: number): string {
  switch (tab) {
    case 'overview': return p.tab_overview;
    case 'library': return p.tab_library;
    case 'favorites': return p.favorites;
    case 'stats': return p.tab_stats;
    case 'reviews': return p.reviews;
    case 'lists': return p.lists;
    case 'bingo': return interpolate(getT().bingo.tab, { year: bingoYear });
    case 'friends': return p.friends;
  }
}

// "_v3": the profile-parity fields (time spent, second rating, journey,
// cover choices; v3: character reactions) are only in the cache after a
// hydrate that carried them, so every profile cached before them
// re-hydrates once.
function lastHydrateKey(userId: string): string {
  return `metadea_social_profile_sync_v3_${userId}`;
}

async function goToOwnProfile(): Promise<void> {
  const { navigate } = await import('astro:transitions/client');
  navigate('/profile');
}

function useQueryUserId(): string | null {
  // No URL to read during the server render; read it once hydrated.
  const hydrated = useHydrated();
  return hydrated ? new URLSearchParams(window.location.search).get('id') : null;
}

// Re-hydrates the local social_user_* cache for this profile at most once a
// day — visiting 900 profiles doesn't mean 900 daily server round trips,
// only the ones you actually open again after the gate expires.
async function hydrateIfStale(userId: string, profile: PublicProfile): Promise<void> {
  const last = localStorage.getItem(lastHydrateKey(userId));
  if (last && Date.now() - parseInt(last, 10) < HYDRATE_INTERVAL_MS) return;

  await hydrateSocialProfile(
    userId,
    toSocialLibraryInputs(profile),
    toSocialActivityInputs(profile),
    profile.monthlyHistory,
    profile.lists.map(l => ({ key: l.key, name: l.name, description: l.description, is_fav: l.is_fav, items: l.items })),
    toSocialCharacterReactionsInput(profile),
  ).catch(() => {});

  localStorage.setItem(lastHydrateKey(userId), String(Date.now()));
}

interface ProfileData extends OverviewData {
  sagaNames: Record<string, string>;
  lists: ListInfo[];
  /** null when it couldn't be computed (outside Tauri, IPC error). */
  taste: TasteCompatibility | null;
  /** Works whose cover the owner picked (see applyOwnerCovers). */
  ownerCoverIds: ReadonlySet<string>;
}

// Their per-type favourites (the profile's `favorites` map) minus
// characters — the shared-favourites row links to media pages.
function favoriteMediaIds(favorites: Record<string, string[]> | undefined): string[] {
  return Object.entries(favorites ?? {})
    .filter(([type]) => type !== 'character')
    .flatMap(([, ids]) => ids);
}

function tasteHighlightIds(taste: TasteCompatibility | null): string[] {
  if (!taste) return [];
  const ids = [...taste.sharedFavorites, ...taste.bothLoved.map(p => p.external_id)];
  for (const pair of taste.disagreements) ids.push(pair.external_id);
  return ids;
}

function getInitialTab(): Tab {
  if (typeof window === 'undefined') return 'overview';
  const params = new URLSearchParams(window.location.search);
  if (params.get('list')) return 'lists';
  const tabParam = params.get('tab') as Tab;
  if (TABS.includes(tabParam)) return tabParam;
  const hash = window.location.hash.replace('#', '') as Tab;
  if (TABS.includes(hash)) return hash;
  return 'overview';
}

export function UserProfileView() {
  const s = getT().social;
  const p = getT().profile;
  const userId = useQueryUserId();
  const [profile, setProfile] = useState<PublicProfile | null | undefined>(undefined);
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<ProfileData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(getInitialTab);
  const [isRedirectingSelf, setIsRedirectingSelf] = useState(false);
  // Like /profile: a tab renders on first visit, then stays mounted (hidden)
  // so its filters/scroll survive switching away and back.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<Tab>>(() => new Set([activeTab]));
  const showTab = (tab: Tab) => {
    setActiveTab(tab);
    setVisitedTabs(prev => (prev.has(tab) ? prev : new Set([...prev, tab])));
  };

  const switchTab = (tab: Tab) => {
    showTab(tab);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (tab === 'overview') {
        url.searchParams.delete('tab');
      } else {
        url.searchParams.set('tab', tab);
      }
      if (tab !== 'lists') {
        url.searchParams.delete('list');
      }
      history.pushState(history.state, '', url.toString());
    }
  };

  useEffect(() => {
    const onPopState = () => {
      showTab(getInitialTab());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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

      // Taste compatibility reads the social_user_list cache hydrateIfStale
      // just wrote, so it runs here and not before.
      const [socialLibrary, socialActivity, socialLists, socialMonthly, characters, tasteData, own, characterReactions] = await Promise.all([
        getSocialLibraryLight(userId).catch(() => []),
        getSocialActivityLight(userId).catch(() => []),
        getSocialLists(userId).catch(() => []),
        getSocialMonthlyHistoryLight(userId).catch(() => []),
        getAllCharactersLight().catch(() => []),
        getTasteCompatibility(userId, favoriteMediaIds(p.favorites)),
        // The viewer's own library + catalog rows: status, genre, hours and
        // profile-vector signals for the taste score (librarySignals).
        getCachedLibraryAndCatalog().catch(() => ({ items: [], catalog: [] as CatalogSummary[] })),
        getSocialCharacterReactions(userId).catch(() => emptyCharacterReactionGroups()),
      ]);
      if (cancelled) return;

      const items = socialLibrary.map(toLibraryEntry);
      const monthlyHistory: Record<string, string[]> = {};
      for (const group of socialMonthly) monthlyHistory[group.month] = group.items.map(i => i.external_id);

      // The viewer's own catalog resolves title/cover for THIS profile's
      // rows — fetched for exactly the ids it renders (library, monthly
      // history, activity) rather than the whole table; unknown ids are
      // simply absent and fall back to their bare external_id as before.
      // The relations set is scoped the same way (see relations-scope.ts).
      const renderedIds = [...new Set([
        ...items.map(i => i.external_id),
        ...socialMonthly.flatMap(group => group.items.map(i => i.external_id)),
        ...socialActivity.map(a => a.external_id),
        // Hall of Fame / favourites needn't be in their synced library.
        ...favoriteMediaIds(p.favorites),
      ])];
      const favorites = p.favorites ?? {};
      const [catalogEntries, sagaRelations, sagaNames, system, coverPathById] = await Promise.all([
        getCatalogEntriesByIds(renderedIds).catch(() => [] as CatalogSummary[]),
        loadScopedMediaRelations(renderedIds),
        getSagaNames(items.map(i => i.external_id)).catch(() => ({} as Record<string, string>)),
        // Same rating system the owner's tabs sync before rendering.
        syncActiveRatingSystemFromCachedInfo(),
        resolveCachedCoverPaths(overviewCoverIds(favorites, monthlyHistory)),
      ]);
      if (cancelled) return;
      const catalogMap = new Map(catalogEntries.map(e => [e.external_id, e]));
      // Their cover choices, not the catalog's (or the viewer's) cover.
      const ownerCoverIds = applyOwnerCovers(catalogMap, coverPathById, socialLibrary);
      const ownCatalog = new Map(own.catalog.map(e => [e.external_id, e]));
      const taste = tasteData
        ? computeTasteCompatibility(tasteData, librarySignals(
          // Hours per medium with each side's own catalog map — the same
          // inputs each Stats tab uses, so the numbers match.
          { entries: own.items, hours: hoursByMedium(own.items, ownCatalog) },
          { entries: items, hours: hoursByMedium(items, catalogMap) },
          id => ownCatalog.get(id) ?? catalogMap.get(id),
        ))
        : null;
      // Shared favourites needn't be in their synced library, so their
      // titles/covers may not be in the map yet.
      const missingHighlightIds = [...new Set(tasteHighlightIds(taste))].filter(id => !catalogMap.has(id));
      if (missingHighlightIds.length > 0) {
        const extra = await getCatalogEntriesByIds(missingHighlightIds).catch(() => [] as CatalogSummary[]);
        if (cancelled) return;
        for (const e of extra) catalogMap.set(e.external_id, e);
      }
      const characterMap = new Map(characters.map(c => [c.external_id, c]));

      setData({
        items, catalogMap, characterMap, sagaRelations, sagaNames, system, coverPathById, favorites, monthlyHistory, ownerCoverIds,
        characterReactions,
        journey: toDayJourney(socialActivity),
        lists: socialLists.map(l => ({ key: l.key, name: l.name, description: l.description, is_fav: l.is_fav, is_private: false, item_count: l.item_count, preview_ids: [] })),
        taste,
      });
    });
    return () => { cancelled = true; };
  }, [userId, isRedirectingSelf]);

  // Same bottom loading bar the owner's tabs show while their data loads —
  // no in-page "loading" placeholder.
  const loadingData = profile != null && data === null;
  useEffect(() => {
    if (!loadingData) return;
    return beginGlobalLoading();
  }, [loadingData]);

  // Their display-name font (Settings > Perfil), loaded the way
  // profile.astro loads the owner's: one @font-face per font id.
  const nameFont = profile?.nameFont ?? null;
  const nameFontFile = nameFont ? getFontFile(nameFont) : undefined;
  useEffect(() => {
    if (!nameFont || !nameFontFile) return;
    const style = document.createElement('style');
    style.textContent = `@font-face { font-family: "pf-${nameFont}"; src: url("/fonts/${nameFontFile}") format("woff2"); font-display: swap; }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [nameFont, nameFontFile]);

  async function toggleFollow() {
    if (!profile || busy) return;
    setBusy(true);
    const ok = following ? await unfollowUser(profile.userId) : await followUser(profile.userId);
    if (ok) setFollowing(f => !f);
    setBusy(false);
  }

  const fetchListItems = useMemo(() => async (listKey: string): Promise<ListItemFull[]> => {
    if (!userId) return [];
    const refs = await getSocialListItemsLight(userId, listKey).catch(() => []);
    return refs.map((r, i) => ({
      external_id: r.external_id, position: i, library_id: null, status: null, rating: null,
      progress: 0, progress_2: 0, is_favorite: false, is_platinum: false,
      title_main: r.title_main, cover_url: r.cover_url, media_type: r.media_type, format: null,
    }));
  }, [userId]);

  const bingoBoards = useMemo(() => (profile ? toPublicBingoBoards(profile) : []), [profile]);

  if (isRedirectingSelf || profile === undefined) return null;

  if (profile === null) {
    return (
      <div className="user-profile-empty">
        <p>{s.user_not_found}</p>
      </div>
    );
  }

  const visibleTabs: readonly Tab[] = bingoBoards.length > 0 ? TABS : TABS.filter(tab => tab !== 'bingo');
  // A ?tab=bingo link to a profile without a board lands on the overview.
  const currentTab: Tab = visibleTabs.includes(activeTab) ? activeTab : 'overview';

  const tabBody = (tab: Tab, d: ProfileData): ReactNode => {
    switch (tab) {
      case 'overview': return <OverviewSection data={d} readOnly />;
      case 'library': return (
        <LibrarySection
          overrideItems={d.items}
          overrideCatalogMap={d.catalogMap}
          overrideSagaRelations={d.sagaRelations}
          overrideSagaNames={d.sagaNames}
          overrideDualRating={profile.dualRating ?? null}
          overrideCoverIds={d.ownerCoverIds}
          readOnly
        />
      );
      case 'favorites': return (
        <FavoritesSection
          overrideItems={d.items}
          overrideCatalogMap={d.catalogMap}
          overrideCharacterMap={d.characterMap}
          overrideFavData={d.favorites}
          readOnly
        />
      );
      case 'stats': return (
        <StatsSection
          overrideItems={d.items}
          overrideCatalogMap={d.catalogMap}
          overrideJourney={d.journey}
          overrideRelations={d.sagaRelations}
          readOnly
        />
      );
      case 'reviews': return <ReviewsSection overrideItems={d.items} overrideCatalogMap={d.catalogMap} />;
      case 'lists': return (
        <ListsSection
          overrideLists={d.lists}
          overrideCatalogMap={d.catalogMap}
          overrideFetchItems={fetchListItems}
          readOnly
        />
      );
      case 'bingo': return <BingoPublicSection boards={bingoBoards} ratingSystem={d.system} owner={{ displayName: profile.username, avatarUrl: profile.avatarUrl || null }} />;
      case 'friends': return <FriendsSection readOnly userId={profile.userId} />;
    }
  };

  return (
    <>
      <div
        className={`profile-banner${profile.bannerUrl ? ' has-custom-bg' : ''}`}
        style={profile.bannerUrl ? { backgroundImage: `url('${profile.bannerUrl}')`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        <div className="profile-banner-content">
          {profile.avatarUrl
            ? <img className="profile-avatar" src={profile.avatarUrl} alt={profile.username} referrerPolicy="no-referrer" />
            : <div className="profile-avatar-placeholder">{(profile.username[0] ?? '?').toUpperCase()}</div>}
          <h1
            className="profile-username-large"
            style={nameFontFile ? { fontFamily: `'pf-${profile.nameFont}', sans-serif` } : undefined}
          >
            {profile.username}
          </h1>
        </div>
        {/* Same placement as the media page's hero buttons: on the banner's
            bottom edge, right side, above the divider — not in the tab row. */}
        <div className="user-profile-banner-actions">
          {/* Icon-only, same box as the heart: UserPlus to follow,
              UserMinus (red on hover) to unfollow. */}
          <button
            type="button"
            className={`user-profile-follow-btn${following ? ' active' : ''}${busy ? ' is-pending' : ''}`}
            onClick={toggleFollow}
            disabled={busy}
            aria-busy={busy || undefined}
            aria-label={following ? s.unfollow : s.follow}
            data-tooltip={following ? s.unfollow : s.follow}
          >
            {following
              ? <UserMinus size={16} strokeWidth={2} aria-hidden="true" />
              : <UserPlus size={16} strokeWidth={2} aria-hidden="true" />}
          </button>
          {/* Only while their public web page is on (Worker webProfilePublic). */}
          {profile.webProfilePublic === true && (
            <button
              type="button"
              className="user-profile-follow-btn profile-web-link-btn"
              onClick={() => { void copyWebProfileLink(profile.userId); }}
              aria-label={getT().settings.web_profile_copy}
              data-tooltip={getT().settings.web_profile_copy}
            >
              <LinkIcon size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
          <TasteHeartButton
            taste={data ? data.taste : undefined}
            catalogMap={data?.catalogMap}
            theirName={profile.username}
            theirAvatarUrl={profile.avatarUrl}
            theirBannerUrl={profile.bannerUrl}
            s={s}
          />
        </div>
      </div>

      <div className="profile-tabs-divider">
        <div className="profile-divider-line"></div>
      </div>

      <nav className="profile-tabs">
        {visibleTabs.map(tab => (
          <button
            key={tab}
            type="button"
            className={`profile-tab${currentTab === tab ? ' active' : ''}`}
            data-tab={tab}
            data-tooltip={tabTooltip(tab, p, bingoBoards[0]?.year ?? new Date().getFullYear())}
            onClick={() => switchTab(tab)}
            dangerouslySetInnerHTML={{ __html: TAB_ICONS[tab] }}
          />
        ))}
      </nav>

      <div className="profile-tab-content">
        {visibleTabs.map(tab => (
          <div
            key={tab}
            id={`tab-pane-${tab}`}
            className={`profile-tab-pane${data && (visitedTabs.has(tab) || tab === currentTab) ? ' pane-ready' : ''}`}
            hidden={tab !== currentTab}
          >
            {data && (visitedTabs.has(tab) || tab === currentTab) && tabBody(tab, data)}
          </div>
        ))}
      </div>
    </>
  );
}
