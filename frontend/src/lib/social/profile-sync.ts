// Once-a-day upload of the current user's public snapshot (bio, rating
// system, theme, recent activity) to the metadea-web server — same pattern
// as syncCommunityCatalog in BaseLayout.astro (localStorage timestamp gate,
// called once per app session with a short delay). Only runs for a real
// Google-linked session; the local "offline_token" mode has no server
// identity to sync to.
import { API_URL } from '../config';
import { getAuthToken, getUserInfo, saveUserInfo, readUserJourney, getAllLibraryEntries, readUserFavorites, readMonthlyHistory, getAllUserLists, getListItems } from '../tauri';
import { STORAGE_KEYS } from '../shared/storage-keys';
import { getImage } from '../storage/images';
import { decodeJwtPayload } from '../profile/utils';

const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVITY_ENTRIES = 30;

// Flattens the day-grouped journey into a single recency-sorted list — the
// feed just needs "what happened, when", not the day-bucket structure the
// local Profile page's calendar view uses it for.
async function compileRecentActivity(): Promise<unknown[]> {
  const journey = await readUserJourney().catch(() => []);
  const flat = journey.flatMap(day =>
    day.events.map(event => ({ date: day.date, ...event }))
  );
  flat.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return flat.slice(0, MAX_ACTIVITY_ENTRIES);
}

// Trimmed to exactly what a viewer needs (id to resolve against their own
// local catalog, score, dates, review text, tags) — not the full row, which
// also carries per-machine bookkeeping (progress, minutes_spent,
// selected_platform/version, ...) nobody else has a use for.
async function compileLibrary(): Promise<unknown[]> {
  const entries = await getAllLibraryEntries().catch(() => []);
  return entries.map(e => ({
    external_id: e.external_id,
    rating:      e.rating,
    started_at:  e.started_at,
    finished_at: e.finished_at,
    notes:       e.notes,
    tags:        e.tags,
  }));
}

// Custom lists (Favoritos/curated lists from the Listas tab) — not the
// per-type "_fav" lists (those are covered by `favorites` already), just
// the user-created ones, since those are what someone else's profile has
// any use rendering.
async function compileLists(): Promise<unknown[]> {
  const lists = await getAllUserLists().catch(() => []);
  const custom = lists.filter(l => !l.is_fav);
  return Promise.all(custom.map(async l => ({
    key: l.key,
    name: l.name,
    description: l.description,
    is_fav: false,
    items: await getListItems(l.key).catch(() => []),
  })));
}

// `force` skips the once-a-day gate below — used by the Settings > Perfil
// "Sincronizar ahora" debug button (temporary, testing-only, see
// ProfileTab.astro) to trigger a real sync on demand instead of waiting up
// to 24h for the normal gate to expire.
export async function syncProfileToServer(force = false): Promise<boolean> {
  if (!navigator.onLine) return false;

  const session = await getAuthToken().catch(() => null);
  if (!session || session.token === 'offline_token') return false;

  // Turso is the only place that ever *assigns* this account's server id
  // (routes/auth.ts, keyed on the Google account, looked up on every login)
  // — this just mirrors it locally from the already-signed JWT so other
  // local code can reference "my own server id" without a network round
  // trip. Runs every session, independent of the once-a-day gate below,
  // since it's a cheap local write with no server call of its own.
  const payload = decodeJwtPayload(session.token);
  if (typeof payload.userId === 'string') {
    const local = await getUserInfo().catch(() => ({} as Record<string, unknown>));
    if (local.server_user_id !== payload.userId) {
      saveUserInfo({ server_user_id: payload.userId }).catch(() => {});
    }
  }

  const lastSync = localStorage.getItem(STORAGE_KEYS.profileSyncLastSync);
  if (!force && lastSync && Date.now() - parseInt(lastSync, 10) < SYNC_INTERVAL_MS) return false;

  try {
    const [info, activity, library, favorites, monthlyHistory, lists, customAvatar, customBanner] = await Promise.all([
      getUserInfo().catch(() => ({} as Record<string, unknown>)),
      compileRecentActivity(),
      compileLibrary(),
      readUserFavorites().catch(() => ({})),
      readMonthlyHistory().catch(() => ({})),
      compileLists(),
      getImage(STORAGE_KEYS.profileAvatarCustom).catch(() => null),
      getImage(STORAGE_KEYS.profileBannerCustom).catch(() => null),
    ]);

    // Same "custom takes priority over Google's own" resolution profile.astro
    // does for the local banner — without this, the server row is stuck
    // forever with whatever Google gave it at first link (name + photo),
    // never reflecting a display name or avatar customized afterward.
    const displayName = (info.display_name as string | undefined)?.trim() || session.username;
    const avatarData = customAvatar || (payload.avatar as string | null) || null;

    // Request body keys match the Turso column names 1:1 (see
    // saveProfileSnapshot in metadea-web) — info.theme is user_profile's own
    // theme column (see theme.ts, which now writes there instead of only
    // localStorage), the actual local source of truth for this.
    const res = await fetch(`${API_URL}/api/profile/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        display_name: displayName,
        avatar_data: avatarData,
        banner_data: customBanner ?? null,
        bio: (info.bio as string | undefined) ?? null,
        rating_system: localStorage.getItem(STORAGE_KEYS.ratingSystem),
        theme: (info.theme as string | undefined) ?? localStorage.getItem(STORAGE_KEYS.appTheme),
        activity,
        library,
        favorites,
        monthly_history: monthlyHistory,
        lists,
      }),
    });

    if (res.ok) {
      localStorage.setItem(STORAGE_KEYS.profileSyncLastSync, String(Date.now()));
    }
    return res.ok;
  } catch (error) {
    console.warn('[ProfileSync] Failed:', error);
    return false;
  }
}
