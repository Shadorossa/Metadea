// Public web profile (Settings > Perfil > "Public web profile", opt-in,
// default off): the part of the daily profile sync (profile-sync.ts) that
// the metadea-web Worker's GET /u/:user page needs and can't derive on its
// own — the owner's Overview numbers, top genres and time by medium (same
// calculators as their own profile) and the titles/covers of the works the
// page shows. Pure; the Worker re-checks every limit
// (metadea-web src/services/validation.ts parseWebProfileSummary).
import type { CatalogSummary, DbMediaRelation, LibraryEntry } from '../tauri';
import { computeOverviewAggregate, computeTopGenres, computeTypeBreakdown } from '../profile/stats-calculators';
import { SHARE_LINK_BASE } from '../deep-link/deep-link-routes';
import type { JourneyPayloadEvent } from './profile-sync-payload';

/** Worker cap (413 above it). */
export const MAX_WEB_PROFILE_WORKS = 400;
const HALL_OF_FAME_SIZE = 10;
// A little over what the page shows (20 activity rows, 12 rated works), in
// case another device's sync reorders the Worker's merged copy slightly.
const RECENT_ACTIVITY_WORKS = 30;
const RECENTLY_RATED_WORKS = 24;
const MAX_TITLE_LENGTH = 300;
const MAX_COVER_URL_LENGTH = 1024;

export interface WebProfileSummaryPayload {
  stats: { total_works: number; completed: number; in_progress: number; average_rating: number | null; hours: number };
  top_genres: Array<{ name: string; count: number }>;
  time_by_type: Array<{ type: string; hours: number; count: number }>;
  works: Array<{ external_id: string; title: string; cover_url: string | null }>;
}

export interface WebProfileSources {
  items: readonly LibraryEntry[];
  catalog: readonly CatalogSummary[];
  relations: readonly DbMediaRelation[];
  /** {type | 'multimedia': externalId[]} — 'multimedia' is the Hall of Fame. */
  favorites: Readonly<Record<string, readonly string[] | undefined>>;
  /** Newest first, as the sync sends it. */
  journey: readonly JourneyPayloadEvent[];
}

function recencyKey(item: LibraryEntry): string {
  return item.updated_at ?? item.finished_at ?? item.added_at ?? '';
}

function publicCoverUrl(url: string | null | undefined): string | null {
  return url && url.length <= MAX_COVER_URL_LENGTH && /^https?:\/\/\S+$/.test(url) ? url : null;
}

/** Every work the web page can show, in page order, without repeats. */
export function webProfileWorkIds(sources: WebProfileSources): string[] {
  const ids = new Set<string>();
  const add = (id: string | undefined) => { if (id && id.includes(':')) ids.add(id); };
  (sources.favorites.multimedia ?? []).slice(0, HALL_OF_FAME_SIZE).forEach(add);
  sources.journey.slice(0, RECENT_ACTIVITY_WORKS).forEach(event => add(event.externalId));
  [...sources.items]
    .filter(item => (item.rating ?? 0) > 0)
    .sort((a, b) => recencyKey(b).localeCompare(recencyKey(a)))
    .slice(0, RECENTLY_RATED_WORKS)
    .forEach(item => add(item.external_id));
  return [...ids].slice(0, MAX_WEB_PROFILE_WORKS);
}

export function buildWebProfileSummary(sources: WebProfileSources): WebProfileSummaryPayload {
  const items = [...sources.items];
  const catalogMap = new Map(sources.catalog.map(row => [row.external_id, row]));
  const overview = computeOverviewAggregate(items, catalogMap, [...sources.relations]);
  const round1 = (value: number) => Math.round(value * 10) / 10;

  const works: WebProfileSummaryPayload['works'] = [];
  for (const id of webProfileWorkIds(sources)) {
    const row = catalogMap.get(id);
    const title = row?.title_main?.trim() || row?.title_english?.trim() || row?.title_romaji?.trim();
    if (!title) continue;
    works.push({ external_id: id, title: title.slice(0, MAX_TITLE_LENGTH), cover_url: publicCoverUrl(row?.cover_url) });
  }

  return {
    stats: {
      total_works: overview.totalWorks,
      completed: overview.completed,
      in_progress: overview.currently,
      average_rating: overview.ratedItems.length > 0 ? Math.round(overview.avgScore * 100) / 100 : null,
      hours: round1(overview.totalHours),
    },
    top_genres: computeTopGenres(items, catalogMap, 10).map(([name, count]) => ({ name, count })),
    time_by_type: computeTypeBreakdown(items, catalogMap).map(({ type, hours, count }) => ({ type, hours, count })),
    works,
  };
}

export type WebProfileSyncFields =
  | Record<string, never>
  | { web_profile_public: false; web_profile: null }
  | { web_profile_public: true; web_profile?: WebProfileSummaryPayload };

/** The sync body's web profile fields for this device's choice. Never
 *  chosen (null) sends nothing, leaving the server's value alone; off always
 *  sends `web_profile: null` (the Worker drops the summary with it); on
 *  without a summary (it couldn't be compiled) keeps the previous one. */
export function webProfileSyncFields(choice: boolean | null, summary: WebProfileSummaryPayload | null): WebProfileSyncFields {
  if (choice === null) return {};
  if (!choice) return { web_profile_public: false, web_profile: null };
  return summary ? { web_profile_public: true, web_profile: summary } : { web_profile_public: true };
}

/** The owner's public page, by account id (stable, unlike display names). */
export function webProfileUrl(serverUserId: string): string {
  return `${SHARE_LINK_BASE}/u/${encodeURIComponent(serverUserId)}`;
}
