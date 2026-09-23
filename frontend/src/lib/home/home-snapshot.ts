// Home's last rendered view-model, persisted so the next visit paints real
// content on the very first frame instead of empty sections that pop in
// once get_home_bundle resolves. Each section reads its slice synchronously
// as initial state, then reconciles with the live data and writes the
// fresh slice back. It is only ever a first-paint hint: live data always
// wins, and any library write (`refresh-profile-library`) drops it.
//
// Alongside it a tiny layout hint (anniversary count for today, number of
// "currently" groups, friends-feed cards, whether there is a Continue
// card) is written under its own key for home.astro's inline pre-paint
// script, which reserves those sections' space before any module has loaded.
import type { LibraryEntry } from '../tauri/library';
import type { CatalogSummary } from '../tauri/catalog';
import type { UpcomingRelease } from '../profile/stats-calculators';
import type { FinishAnniversaryItem } from './finish-anniversaries';
import type { LastWatched } from './continue-watching';
import type { AiringTodayRow } from './airing-today';
import { STORAGE_KEYS } from '../storage/storage-keys';

const VERSION = 2;

export interface CurrentlyCardItem {
  linkId: string;
  trackedEntry: LibraryEntry;
  coverUrl: string | null;
  displayProgress: number;
  seasonMembers?: Array<{ entry: LibraryEntry; total: number }>;
}

export interface CurrentlyTypeGroup {
  type: string;
  items: CurrentlyCardItem[];
}

/** The Continue card's data: the pick plus what the card shows of the work. */
export interface ContinueCardData extends LastWatched {
  title: string;
  mediaType: string;
  coverUrl: string | null;
}

export interface HomeSnapshot {
  v: typeof VERSION;
  /** Local YYYY-MM-DD the anniversary slice was computed for. */
  date: string;
  /** Cheap library fingerprint (see libraryVersion). */
  libraryVersion: string;
  anniversary: FinishAnniversaryItem[];
  currently: CurrentlyTypeGroup[];
  /** YYYY-MM of the "Para ti" calendar slice. */
  calendarMonth: string;
  calendar: UpcomingRelease[];
  feedCatalog: Record<string, CatalogSummary>;
  /** Cards the friends feed's first page showed. */
  feedCount: number;
  /** Whether the friends feed had more than one page. */
  feedPaged: boolean;
  continueWatching: ContinueCardData | null;
  /** Local YYYY-MM-DD the airing rows are for. */
  airingDate: string;
  airing: AiringTodayRow[];
}

export interface HomeLayoutHint {
  /** Local date of `a`. */
  d: string;
  /** Anniversary works for that date. */
  a: number;
  /** "Currently" type groups. */
  g: number;
  /** Friends-feed cards on page 1. */
  f: number;
  /** 1 when the friends feed paginates. */
  fp: number;
  /** 1 when there is a Continue card. */
  c: number;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): StorageLike | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

const pad = (n: number) => String(n).padStart(2, '0');

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localMonthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** Library fingerprint: row count plus the newest updated_at. */
export function libraryVersion(items: ReadonlyArray<Pick<LibraryEntry, 'updated_at'>>): string {
  let newest = '';
  for (const item of items) if ((item.updated_at ?? '') > newest) newest = item.updated_at ?? '';
  return `${items.length}:${newest}`;
}

function emptySnapshot(): HomeSnapshot {
  return { v: VERSION, date: '', libraryVersion: '', anniversary: [], currently: [], calendarMonth: '', calendar: [], feedCatalog: {}, feedCount: 0, feedPaged: false, continueWatching: null, airingDate: '', airing: [] };
}

function reviveReleases(releases: unknown): UpcomingRelease[] {
  if (!Array.isArray(releases)) return [];
  return releases.map(r => ({ ...(r as UpcomingRelease), releaseDate: new Date((r as { releaseDate: string }).releaseDate) }));
}

/** The stored snapshot, or null when missing, unreadable or of an older shape. */
export function readHomeSnapshot(storage: StorageLike | null = defaultStorage()): HomeSnapshot | null {
  try {
    const raw = storage?.getItem(STORAGE_KEYS.homeSnapshot);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HomeSnapshot;
    if (!parsed || parsed.v !== VERSION) return null;
    return { ...emptySnapshot(), ...parsed, calendar: reviveReleases(parsed.calendar) };
  } catch {
    return null;
  }
}

/** Today's anniversary slice, or null when the snapshot is for another day. */
export function snapshotAnniversary(snapshot: HomeSnapshot | null, now: Date): FinishAnniversaryItem[] | null {
  return snapshot && snapshot.date === localDateKey(now) ? snapshot.anniversary : null;
}

/** Today's "Airing today" rows, or null when the snapshot is for another day. */
export function snapshotAiring(snapshot: HomeSnapshot | null, now: Date): AiringTodayRow[] | null {
  return snapshot && snapshot.airingDate === localDateKey(now) ? snapshot.airing : null;
}

/** This month's "Para ti" calendar slice, or null when it is for another month. */
export function snapshotCalendar(snapshot: HomeSnapshot | null, now: Date): UpcomingRelease[] | null {
  return snapshot && snapshot.calendarMonth === localMonthKey(now) ? snapshot.calendar : null;
}

/** Merges `patch` into the stored snapshot and refreshes the layout hint.
 *  Storage failures are ignored — the snapshot is a disposable cache. */
export function updateHomeSnapshot(patch: Partial<Omit<HomeSnapshot, 'v'>>, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  const next: HomeSnapshot = { ...(readHomeSnapshot(storage) ?? emptySnapshot()), ...patch, v: VERSION };
  const hint: HomeLayoutHint = {
    d: next.date,
    a: next.anniversary.length,
    g: next.currently.length,
    f: next.feedCount,
    fp: next.feedPaged ? 1 : 0,
    c: next.continueWatching ? 1 : 0,
  };
  try {
    storage.setItem(STORAGE_KEYS.homeSnapshot, JSON.stringify(next));
    storage.setItem(STORAGE_KEYS.homeLayoutHint, JSON.stringify(hint));
  } catch { /* quota: keep whatever was there */ }
}

export function clearHomeSnapshot(storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEYS.homeSnapshot);
    storage?.removeItem(STORAGE_KEYS.homeLayoutHint);
  } catch { /* nothing to clear */ }
}

/** Same ids in the same order — lets a reconcile skip a no-op re-render. */
export function sameIds<T>(a: readonly T[], b: readonly T[], id: (item: T) => string): boolean {
  return a.length === b.length && a.every((item, i) => id(item) === id(b[i]));
}

if (typeof window !== 'undefined') {
  window.addEventListener('refresh-profile-library', () => clearHomeSnapshot());
}
