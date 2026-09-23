// Server snapshot (lib/social/users.ts's PublicProfile) → the local
// social_user_* cache (hydrate_social_profile) → the shapes the owner's own
// profile components read. Kept apart from UserProfileView so the mapping
// is testable and the view only wires data.
import type {
  CatalogSummary, DayJourney, UserJourneyEvent,
  SocialActivityInput, SocialActivityItem, SocialLibraryInput, SocialLibraryItem,
  SocialCharacterReactionsInput,
} from '../tauri';
import type { PublicProfile } from './users';
import type { BingoCell } from '../tauri/yearly-bingo';
import { MAX_BINGO_SIZE, MIN_BINGO_SIZE } from '../bingo/bingo-grid';
import { summarizeBingoCells, type BingoResult } from '../bingo/bingo-result';

const JOURNEY_TYPES: ReadonlySet<string> = new Set(['start', 'complete', 'progress']);

// Library rows for hydrate_social_profile, each carrying the owner's chosen
// cover (their cover preference) when they synced one.
export function toSocialLibraryInputs(profile: Pick<PublicProfile, 'library' | 'coverPreferences'>): SocialLibraryInput[] {
  const covers = profile.coverPreferences ?? {};
  return profile.library.map(item => ({
    external_id: item.external_id,
    rating: item.rating ?? null,
    started_at: item.started_at ?? null,
    finished_at: item.finished_at ?? null,
    notes: item.notes ?? null,
    tags: item.tags ?? null,
    status: item.status ?? null,
    progress: item.progress ?? null,
    rating_2: item.rating_2 ?? null,
    progress_2: item.progress_2 ?? null,
    minutes_spent: item.minutes_spent ?? null,
    reconsumption_count: item.reconsumption_count ?? null,
    reconsuming: item.reconsuming ?? null,
    preferred_cover: covers[item.external_id] ?? null,
  }));
}

// The full journey (every kind, last year) when the owner's app synced it;
// otherwise the 30 latest completions every profile has always carried.
export function toSocialActivityInputs(profile: Pick<PublicProfile, 'activity' | 'journey'>): SocialActivityInput[] {
  const source = profile.journey && profile.journey.length > 0 ? profile.journey : profile.activity;
  return source.map(event => ({
    externalId: event.externalId,
    type: event.type,
    mediaType: event.mediaType ?? null,
    date: event.date ?? null,
    timestamp: event.timestamp,
    progressStart: event.progressStart ?? null,
    progressEnd: event.progressEnd ?? null,
    occurrence: event.occurrence ?? null,
  }));
}

/** Their character reactions for hydrate_social_profile; null = not shared.
 *  Rows without an external_id are skipped (the Worker validated them). */
export function toSocialCharacterReactionsInput(profile: Pick<PublicProfile, 'characterReactions'>): SocialCharacterReactionsInput | null {
  const source = profile.characterReactions;
  if (!source || typeof source !== 'object') return null;
  const list = (entries: unknown): SocialCharacterReactionsInput['like'] => (Array.isArray(entries) ? entries as unknown[] : [])
    .flatMap(raw => {
      if (typeof raw !== 'object' || raw === null) return [];
      const e = raw as { external_id?: unknown; name?: unknown; image_url?: unknown };
      if (typeof e.external_id !== 'string' || !e.external_id) return [];
      return [{
        external_id: e.external_id,
        name: typeof e.name === 'string' ? e.name : null,
        image_url: typeof e.image_url === 'string' ? e.image_url : null,
      }];
    });
  return { like: list(source.like), interest: list(source.interest), dislike: list(source.dislike) };
}

// The social activity cache (already event-shaped, each row carrying its
// own `date`) as the day-grouped DayJourney[] ActivitySection/StatsSection
// read from readUserJourneyTyped() on the owner's profile — every kind the
// owner's own journey holds, newest day first.
export function toDayJourney(activity: ReadonlyArray<Pick<SocialActivityItem,
  'external_id' | 'event_type' | 'media_type' | 'date' | 'timestamp' | 'progress_start' | 'progress_end' | 'occurrence'
>>): DayJourney[] {
  const byDate = new Map<string, UserJourneyEvent[]>();
  for (const a of activity) {
    if (!JOURNEY_TYPES.has(a.event_type)) continue;
    const date = a.date ?? a.timestamp.slice(0, 10);
    const list = byDate.get(date) ?? [];
    list.push({
      externalId: a.external_id,
      type: a.event_type as UserJourneyEvent['type'],
      progressStart: a.progress_start ?? undefined,
      progressEnd: a.progress_end ?? undefined,
      occurrence: a.occurrence ?? undefined,
      mediaType: a.media_type ?? '',
      timestamp: a.timestamp,
    });
    byDate.set(date, list);
  }
  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, events]) => ({ date, events }));
}

// The owner's cover choices over the viewer's catalog rows: the card shows
// the cover they picked, and the disk cover cache (which holds the
// catalog's original) is skipped for those works — same rule
// filterCoverCacheCandidates applies to the viewer's own choices. Returns
// the ids it overrode (LibrarySection skips its own cache for them too).
export function applyOwnerCovers(
  catalogMap: Map<string, CatalogSummary>,
  coverPathById: Map<string, string>,
  library: ReadonlyArray<Pick<SocialLibraryItem, 'external_id' | 'preferred_cover'>>,
): Set<string> {
  const overridden = new Set<string>();
  for (const item of library) {
    if (!item.preferred_cover) continue;
    const row = catalogMap.get(item.external_id);
    if (row) catalogMap.set(item.external_id, { ...row, cover_url: item.preferred_cover });
    coverPathById.delete(item.external_id);
    overridden.add(item.external_id);
  }
  return overridden;
}

export interface PublicBingoBoard {
  year: number;
  /** Exactly the board's size. */
  cells: BingoCell[];
  /** From the owner's synced result; null before its result phase. */
  result: BingoResult | null;
}

function toPublicBingoCell(raw: unknown): BingoCell {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as { external_id?: unknown; title?: unknown; cover_url?: unknown; media_type?: unknown };
  if (typeof c.external_id !== 'string' || !c.external_id) return null;
  return {
    external_id: c.external_id,
    title: typeof c.title === 'string' ? c.title : c.external_id,
    cover_url: typeof c.cover_url === 'string' && /^https:\/\//.test(c.cover_url) ? c.cover_url : null,
    media_type: typeof c.media_type === 'string' ? c.media_type : c.external_id.split(':')[0],
  };
}

/** Their bingo boards (newest year first) as the read-only board renders
 *  them. Boards with no picked work or an off-shape size are left out; the
 *  result is the owner's own (their library and scores), never recomputed
 *  from the viewer's. */
export function toPublicBingoBoards(profile: Pick<PublicProfile, 'bingo'>): PublicBingoBoard[] {
  if (!Array.isArray(profile.bingo)) return [];
  const boards: PublicBingoBoard[] = [];
  for (const raw of profile.bingo) {
    if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.cells) || !Number.isInteger(raw.year)) continue;
    const size = raw.size ?? raw.cells.length;
    if (!Number.isInteger(size) || size < MIN_BINGO_SIZE || size > MAX_BINGO_SIZE || raw.cells.length !== size) continue;
    const cells = raw.cells.map(toPublicBingoCell);
    if (!cells.some(Boolean)) continue;
    const completed = raw.result?.completed;
    const scores = raw.result?.scores;
    const result = Array.isArray(completed) && completed.length === size
      ? summarizeBingoCells(
        cells.map((_, i) => ({
          done: completed[i] === true,
          rating: Array.isArray(scores) && typeof scores[i] === 'number' ? scores[i] : null,
        })),
        cells.map(Boolean),
      )
      : null;
    boards.push({ year: raw.year, cells, result });
  }
  return boards.sort((a, b) => b.year - a.year);
}
