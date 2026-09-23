import { graphqlPost } from '../api/client';
import { API_ENDPOINTS } from '../api/endpoints';
import { getT } from '../../i18n/runtime';
import { computeUpcomingPlanningReleases } from '../profile/stats-calculators';
import { getAllLibraryEntries, isTauri, type CatalogSummary } from '../tauri';
import { loadHomeData } from '../home/home-data';
import { notifySystem } from './notifications';
import { STORAGE_KEYS } from '../storage/storage-keys';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
// A window focus used to re-run the whole check — and with it a fresh
// library/catalog fetch — every single time the user alt-tabbed back. Nothing
// about "today's releases" changes minute to minute, so a focus only
// re-checks once this long has passed since the previous check started,
// and only the local part (see checkNotifications): the weekly AniList
// airing query is never fired by a focus alone, the hourly interval
// carries it.
const FOCUS_RECHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TITLES_IN_BODY = 4;

/** One library anime's next episode as of the last weekly check. */
export interface LibraryAiringEntry {
  externalId: string;
  /** Unix seconds. */
  airingAt: number;
  episode: number;
}

interface NotificationState {
  releaseDate?: string;
  releaseIds?: string[];
  airingCheckedAt?: number;
  /** What the weekly check learnt, kept for Home's "Airing today" card
   *  (lib/home/airing-today.ts projects it week by week). */
  airingSchedule?: LibraryAiringEntry[];
}

interface AiringAnime {
  id: number;
  status: string | null;
  title: { romaji: string | null; english: string | null };
  nextAiringEpisode: { airingAt: number; episode: number } | null;
}

let started = false;
let checking = false;
let lastCheckStartedAt = 0;

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function readState(): NotificationState {
  try {
    const value = localStorage.getItem(STORAGE_KEYS.libraryReleaseNotifications);
    return value ? JSON.parse(value) as NotificationState : {};
  } catch {
    return {};
  }
}

/** The weekly check's airing schedule (empty until it has run once). */
export function readLibraryAiringSchedule(): LibraryAiringEntry[] {
  const schedule = readState().airingSchedule;
  return Array.isArray(schedule) ? schedule : [];
}

function writeState(state: NotificationState): void {
  try {
    localStorage.setItem(STORAGE_KEYS.libraryReleaseNotifications, JSON.stringify(state));
  } catch {
    // Storage being unavailable must not disrupt normal app startup.
  }
}

function renderList(names: string[]): string {
  const visible = names.slice(0, MAX_TITLES_IN_BODY);
  const extra = names.length - visible.length;
  return extra > 0 ? `${visible.join(', ')} (+${extra})` : visible.join(', ');
}

function template(value: string, count: number, titles: string): string {
  return value.replace('{count}', String(count)).replace('{titles}', titles);
}

async function checkTodayReleases(
  entries: Awaited<ReturnType<typeof getAllLibraryEntries>>,
  catalog: CatalogSummary[],
  now: Date,
): Promise<void> {
  const catalogMap = new Map(catalog.map(entry => [entry.external_id, entry]));
  const todayKey = localDateKey(now);
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const releases = computeUpcomingPlanningReleases(entries, catalogMap, firstOfMonth)
    .filter(release => localDateKey(release.releaseDate) === todayKey);
  if (releases.length === 0) return;

  const state = readState();
  const notifiedIds = state.releaseDate === todayKey ? new Set(state.releaseIds ?? []) : new Set<string>();
  const pending = releases.filter(release => !notifiedIds.has(release.externalId));
  if (pending.length === 0) return;

  const p = getT().notifications;
  const sent = await notifySystem(
    p.release_day_title,
    template(p.release_day_body, pending.length, renderList(pending.map(item => item.title))),
  );
  if (!sent) return;

  for (const release of pending) notifiedIds.add(release.externalId);
  writeState({ ...state, releaseDate: todayKey, releaseIds: [...notifiedIds] });
}

async function fetchAiringAnime(ids: number[]): Promise<AiringAnime[] | null> {
  if (ids.length === 0) return [];
  const query = `
    query LibraryAiring($ids: [Int]) {
      Page(page: 1, perPage: 50) {
        media(id_in: $ids, type: ANIME) {
          id status title { romaji english }
          nextAiringEpisode { airingAt episode }
        }
      }
    }
  `;
  const results: AiringAnime[] = [];
  for (let offset = 0; offset < ids.length; offset += 50) {
    const { ok, result } = await graphqlPost<{ Page?: { media?: AiringAnime[] } }>(
      API_ENDPOINTS.ANILIST,
      query,
      { ids: ids.slice(offset, offset + 50) },
    ).catch(() => ({ ok: false, status: 0, result: null }));
    if (!ok || !result?.data?.Page) return null;
    results.push(...(result.data.Page.media ?? []));
  }
  return results;
}

async function checkWeeklyAiring(entries: Awaited<ReturnType<typeof getAllLibraryEntries>>, catalog: CatalogSummary[]): Promise<void> {
  const state = readState();
  const nowMs = Date.now();
  if (state.airingCheckedAt && nowMs - state.airingCheckedAt < WEEK_MS) return;

  const trackedIds = entries
    .filter(item => item.type === 'anime' && item.status !== 'completed' && item.status !== 'dropped')
    .map(item => /^anime:(\d+)$/.exec(item.external_id)?.[1])
    .filter((id): id is string => Boolean(id));
  const ids = [...new Set(trackedIds.map(Number))];
  if (ids.length === 0) {
    writeState({ ...state, airingCheckedAt: nowMs });
    return;
  }

  const airing = await fetchAiringAnime(ids);
  // Keep the interval open after network/API failures so a temporary outage
  // doesn't skip the user's entire weekly reminder.
  if (airing === null) return;

  const incomplete = airing.filter(item => item.status === 'RELEASING' && item.nextAiringEpisode);
  // Kept whether or not the notification below goes out: Home reads it.
  writeState({
    ...readState(),
    airingSchedule: incomplete.flatMap(item => item.nextAiringEpisode
      ? [{ externalId: `anime:${item.id}`, airingAt: item.nextAiringEpisode.airingAt, episode: item.nextAiringEpisode.episode }]
      : []),
  });
  const catalogMap = new Map(catalog.map(entry => [entry.external_id, entry]));
  const names = incomplete.map(item =>
    catalogMap.get(`anime:${item.id}`)?.title_main || item.title.romaji || item.title.english || `#${item.id}`
  );

  if (names.length > 0) {
    const p = getT().notifications;
    const sent = await notifySystem(
      p.airing_weekly_title,
      template(p.airing_weekly_body, names.length, renderList(names)),
    );
    if (!sent) return;
  }

  // Successful checks (including an empty result) establish the weekly
  // cadence; failed checks above remain retryable.
  writeState({ ...readState(), airingCheckedAt: nowMs });
}

async function checkNotifications(allowNetwork = true): Promise<void> {
  if (checking || !isTauri() || !navigator.onLine) return;
  checking = true;
  lastCheckStartedAt = Date.now();
  try {
    // The same library/catalog bundle the Profile and Home pages read (and
    // that every library write invalidates) — de-duplicates this checker's
    // own copy against whatever page is loading at the same moment instead
    // of a second full catalog query. This runs on every page load before
    // the Home islands' effects, so it is what primes that cache through
    // get_home_bundle (one round trip) on a cold start.
    const { items: entries, catalog } = await loadHomeData();
    const now = new Date();
    await checkTodayReleases(entries, catalog, now);
    if (allowNetwork) await checkWeeklyAiring(entries, catalog);
  } catch (error) {
    console.warn('[notifications] Could not check library reminders', error);
  } finally {
    checking = false;
  }
}

/** Starts app-wide release reminders once the local database is ready. */
export function startLibraryReleaseNotifications(): void {
  if (started || !isTauri()) return;
  started = true;
  void checkNotifications();
  window.setInterval(() => { void checkNotifications(); }, CHECK_INTERVAL_MS);
  window.addEventListener('focus', () => {
    if (Date.now() - lastCheckStartedAt < FOCUS_RECHECK_MIN_INTERVAL_MS) return;
    void checkNotifications(false);
  });
}
