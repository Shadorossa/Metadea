// Once-a-day upload of the current user's public snapshot (bio, rating
// system, theme, name font, library with real time spent, journey, cover
// choices — see profile-sync-payload.ts) to the metadea-web server — same pattern
// as syncCommunityCatalog in BaseLayout.astro (localStorage timestamp gate,
// prompted on Home once per local calendar day). Only runs for a real
// Google-linked session; the local "offline_token" mode has no server
// identity to sync to.
import { API_URL } from '../api/urls';
import { getAuthToken, getUserInfo, saveUserInfo, readUserJourneyTyped, getAllLibraryEntries, readUserFavoritesTyped, readMonthlyHistoryTyped, getAllUserLists, getListItems } from '../tauri';
import { STORAGE_KEYS } from '../storage/storage-keys';
import { getImage } from '../storage/images';
import { decodeJwtPayload } from '../profile/media-type-label';
import { readCoverPreferences } from '../media/cover-preferences';
import { getCharacterReactions } from '../tauri/character-reactions';
import { getYearlyBingo, type YearlyBingoData } from '../tauri/yearly-bingo';
import { getCachedLibraryAndCatalog, getCachedMediaRelations } from '../profile/library-data-cache';
import { buildWebProfileSummary, webProfileSyncFields, type WebProfileSummaryPayload } from './web-profile-payload';
import {
  getWebProfilePublicChoice, isDualRatingEnabled, getRatingName1, getRatingName2, getRating2System, getRating2Min, getRating2Max,
} from '../storage/preferences';
import {
  buildLibraryPayload, buildJourneyPayload, buildCoverPreferencesPayload, buildDualRatingPayload, normalizeNameFont,
  buildCharacterReactionsPayload, buildBingoPayload,
  type LibraryPayloadItem, type JourneyPayloadEvent, type CharacterReactionsPayload, type BingoPayloadYear,
} from './profile-sync-payload';

export const PROFILE_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_ACTIVITY_ENTRIES = 30;

export interface SyncAttemptRecord {
  at:     number;
  result: 'success' | 'skipped_offline' | 'skipped_no_session' | 'skipped_gate' | 'failed_response' | 'failed_error';
  detail?: string;
}

// Every automatic attempt used to be a total black box — a failure only ever
// hit console.warn, invisible unless DevTools happened to be open at that
// exact moment, so there was no way to tell "it never even tried today" from
// "it tried and the server rejected it" from "it's just waiting out the 24h
// gate". Settings > Perfil reads this back to show that history instead of
// only ever reflecting whatever the last [TEST] click happened to do.
function recordAttempt(record: SyncAttemptRecord): void {
  try {
    localStorage.setItem(STORAGE_KEYS.profileSyncLastAttempt, JSON.stringify(record));
  } catch { /* localStorage unavailable/full — the sync itself already ran either way */ }
}

// Flattens the day-grouped journey into a single recency-sorted list — the
// feed just needs "what happened, when", not the day-bucket structure the
// local Profile page's calendar view uses it for.
async function compileActivity(): Promise<{ activity: unknown[]; journey: JourneyPayloadEvent[] }> {
  const journey = await readUserJourneyTyped().catch(() => []);
  const flat = journey.flatMap(day =>
    day.events
      .filter(event => event.type === 'complete')
      .map(event => ({ date: day.date, ...event }))
  );
  flat.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  // `activity` (the feed's 30 latest completions) and `journey` (every
  // kind, last year — the public profile's heatmap/activity/pace).
  return { activity: flat.slice(0, MAX_ACTIVITY_ENTRIES), journey: buildJourneyPayload(journey) };
}

// The whole library (the Worker keeps it as this device's snapshot) with
// real time spent and re-runs — see buildLibraryPayload.
async function compileLibrary(): Promise<LibraryPayloadItem[]> {
  const entries = await getAllLibraryEntries().catch(() => []);
  return buildLibraryPayload(entries, isDualRatingEnabled());
}

// Like / interest / dislike character lists. null when they can't be read
// — the field is then left out so the server keeps what it had.
async function compileCharacterReactions(): Promise<CharacterReactionsPayload | null> {
  try {
    return buildCharacterReactionsPayload(await getCharacterReactions());
  } catch {
    return null;
  }
}

// Yearly Bingo boards of the current and previous year (whichever exist),
// with their result once in the result phase. null when a board or the
// library can't be read — the field is then left out so the server keeps
// what it had instead of publishing an empty board or a zeroed result.
async function compileBingo(now: Date): Promise<BingoPayloadYear[] | null> {
  try {
    const year = now.getFullYear();
    const [current, previous, library] = await Promise.all([
      getYearlyBingo(year),
      getYearlyBingo(year - 1),
      getAllLibraryEntries(),
    ]);
    const boards = [current, previous].filter((board): board is YearlyBingoData => board !== null);
    return buildBingoPayload(boards, library, now);
  } catch {
    return null;
  }
}

// Public web profile summary (stats, genres, time by medium, titles/covers
// of the works the page shows) — only compiled while the owner has the web
// profile on. null when it can't be: the field is then left out so the
// server keeps what it had, and a failed library load (which the profile
// cache reports as an empty library) never publishes zeros.
async function compileWebProfile(
  library: readonly LibraryPayloadItem[],
  favorites: Readonly<Record<string, readonly string[] | undefined>>,
  journey: JourneyPayloadEvent[],
): Promise<WebProfileSummaryPayload | null> {
  try {
    const [{ items, catalog }, relations] = await Promise.all([getCachedLibraryAndCatalog(), getCachedMediaRelations()]);
    if (items.length === 0 && library.length > 0) return null;
    return buildWebProfileSummary({ items, catalog, relations, favorites, journey });
  } catch {
    return null;
  }
}

// Custom lists (Favoritos/curated lists from the Listas tab) — not the
// per-type "_fav" lists (those are covered by `favorites` already), just
// the user-created ones, since those are what someone else's profile has
// any use rendering.
async function compileLists(): Promise<unknown[]> {
  const lists = await getAllUserLists().catch(() => []);
  // A list marked private (Editar > Privada) never leaves this device —
  // excluded here rather than relying on the server to filter it, so it
  // can't end up in the request body at all.
  const custom = lists.filter(l => !l.is_fav && !l.is_private);
  return Promise.all(custom.map(async l => ({
    key: l.key,
    name: l.name,
    description: l.description,
    is_fav: false,
    items: await getListItems(l.key).catch(() => []),
  })));
}

// `force` skips the rolling 24-hour gate below. The Home prompt checks
// successful syncs by local calendar day and calls this with `true` so the
// prompt timing follows the user's day boundary rather than a 24-hour timer.
export async function syncProfileToServer(force = false): Promise<boolean> {
  if (!navigator.onLine) {
    recordAttempt({ at: Date.now(), result: 'skipped_offline' });
    return false;
  }

  const session = await getAuthToken().catch(() => null);
  if (!session || session.token === 'offline_token') {
    recordAttempt({ at: Date.now(), result: 'skipped_no_session' });
    return false;
  }

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
  if (!force && lastSync && Date.now() - parseInt(lastSync, 10) < PROFILE_SYNC_INTERVAL_MS) {
    recordAttempt({ at: Date.now(), result: 'skipped_gate', detail: `last success ${new Date(parseInt(lastSync, 10)).toISOString()}` });
    return false;
  }

  try {
    const [info, { activity, journey }, library, favorites, monthlyHistory, lists, customAvatar, customBanner, shareAvatar, characterReactions, bingo] = await Promise.all([
      getUserInfo().catch(() => ({} as Record<string, unknown>)),
      compileActivity(),
      compileLibrary(),
      readUserFavoritesTyped().catch(() => ({})),
      readMonthlyHistoryTyped().catch(() => ({})),
      compileLists(),
      getImage(STORAGE_KEYS.profileAvatarCustom).catch(() => null),
      getImage(STORAGE_KEYS.profileBannerCustom).catch(() => null),
      getImage(STORAGE_KEYS.shareAvatarCustom).catch(() => null),
      compileCharacterReactions(),
      compileBingo(new Date()),
    ]);

    // Social cards use the image chosen for sharing first, falling back to
    // the normal custom avatar and then Google's photo when no share image
    // was configured.
    const displayName = (info.display_name as string | undefined)?.trim() || session.username;
    const avatarData = shareAvatar || customAvatar || (payload.avatar as string | null) || null;
    const webProfileChoice = getWebProfilePublicChoice();
    const webProfile = webProfileChoice === true
      ? await compileWebProfile(library, favorites, journey)
      : null;

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
        name_font: normalizeNameFont(info.font),
        journey,
        cover_preferences: buildCoverPreferencesPayload(
          readCoverPreferences(),
          new Set(library.map(item => item.external_id)),
        ),
        dual_rating: buildDualRatingPayload({
          enabled: isDualRatingEnabled(),
          name1: getRatingName1(''),
          name2: getRatingName2(''),
          system2: getRating2System(),
          min2: getRating2Min(),
          max2: getRating2Max(),
        }),
        ...(characterReactions ? { character_reactions: characterReactions } : {}),
        ...(bingo ? { bingo } : {}),
        ...webProfileSyncFields(webProfileChoice, webProfile),
      }),
    });

    if (res.ok) {
      localStorage.setItem(STORAGE_KEYS.profileSyncLastSync, String(Date.now()));
      recordAttempt({ at: Date.now(), result: 'success' });
    } else {
      const body = await res.text().catch(() => '');
      recordAttempt({ at: Date.now(), result: 'failed_response', detail: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` });
    }
    return res.ok;
  } catch (error) {
    console.warn('[ProfileSync] Failed:', error);
    recordAttempt({ at: Date.now(), result: 'failed_error', detail: String(error).slice(0, 200) });
    return false;
  }
}
