// Pure builders for the profile-parity part of the daily profile sync
// (profile-sync.ts): what another user's /user?id=… page needs to render
// this profile exactly like its owner sees it — real time spent, the second
// rating and how it is shown, every journey kind, cover choices and the
// display-name font. The Worker re-checks every limit (metadea-web
// src/services/validation.ts); these stay safely under them.
import type { DayJourney, LibraryEntry } from '../tauri';
import type { RatingSystem } from '../media/rating-utils';
import { CHARACTER_REACTIONS, type CharacterReaction, type CharacterReactionGroups } from '../character/character-reactions';
import type { BingoCell, YearlyBingoData } from '../tauri/yearly-bingo';
import { isBingoResultPhase } from '../bingo/bingo-calendar';
import { MAX_BINGO_SIZE, MIN_BINGO_SIZE } from '../bingo/bingo-grid';
import { computeBingoResult, type BingoLibraryRow } from '../bingo/bingo-result';

/** How far back the synced journey reaches (heatmap, activity, pace). */
export const SYNCED_JOURNEY_DAYS = 365;
/** Worker cap is 5000; a year of daily logging stays well below this. */
export const MAX_SYNCED_JOURNEY_EVENTS = 4000;
const MAX_COVER_URL_LENGTH = 1024;
const FONT_ID_RE = /^[a-z0-9_-]{1,40}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LibraryPayloadItem {
  external_id: string;
  type: string;
  status: string | null;
  progress: number;
  progress_2: number;
  rating: number | null;
  rating_2: number | null;
  minutes_spent: number;
  reconsumption_count: number;
  reconsuming: number;
  started_at: string | null;
  finished_at: string | null;
  added_at: string | null;
  updated_at: string | null;
  notes: string | null;
  tags: string[] | null;
}

// Trimmed to what a viewer needs — status/progress (so another device can
// restore a real library, not just a title list), both ratings, time spent
// and re-runs (Stats / "Total hours" / backlog), dates (updated_at lets the
// Worker keep a fresher edit from another device), review text, tags.
// Still leaves out per-machine bookkeeping (selected platform/version,
// favorite/platinum flags). rating_2 only travels when the owner shows a
// second rating at all — otherwise their own profile never displays it.
export function buildLibraryPayload(entries: readonly LibraryEntry[], includeRating2: boolean): LibraryPayloadItem[] {
  return entries.map(e => ({
    external_id: e.external_id,
    type: e.type,
    status: e.status,
    progress: e.progress,
    progress_2: e.progress_2,
    rating: e.rating,
    rating_2: includeRating2 ? e.rating_2 : null,
    minutes_spent: e.minutes_spent,
    reconsumption_count: e.reconsumption_count ?? 0,
    reconsuming: e.reconsuming ? 1 : 0,
    started_at: e.started_at,
    finished_at: e.finished_at,
    added_at: e.added_at,
    updated_at: e.updated_at,
    notes: e.notes,
    tags: e.tags,
  }));
}

export interface JourneyPayloadEvent {
  externalId: string;
  type: string;
  mediaType: string;
  date: string;
  timestamp: string;
  progressStart?: number;
  progressEnd?: number;
  occurrence?: number;
}

// Every journey kind (start / progress / complete, with the re-run
// occurrence) from the last SYNCED_JOURNEY_DAYS days, newest first, capped
// at MAX_SYNCED_JOURNEY_EVENTS — the feed's separate `activity` keeps its
// 30 latest completions.
export function buildJourneyPayload(journey: readonly DayJourney[], now: Date = new Date()): JourneyPayloadEvent[] {
  const from = new Date(now.getTime() - SYNCED_JOURNEY_DAYS * DAY_MS).toISOString().slice(0, 10);
  const flat: JourneyPayloadEvent[] = [];
  for (const day of journey) {
    if (day.date < from) continue;
    for (const event of day.events ?? []) {
      flat.push({
        externalId: event.externalId,
        type: event.type,
        mediaType: event.mediaType,
        date: day.date,
        timestamp: event.timestamp,
        ...(event.progressStart != null ? { progressStart: event.progressStart } : {}),
        ...(event.progressEnd != null ? { progressEnd: event.progressEnd } : {}),
        ...(event.occurrence != null ? { occurrence: event.occurrence } : {}),
      });
    }
  }
  flat.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return flat.slice(0, MAX_SYNCED_JOURNEY_EVENTS);
}

// Cover choices (lib/media/cover-preferences.ts) for works in the synced
// library only, and only public http(s) URLs: an asset:// path points at
// this machine's disk and a data: URL is a whole image — neither means
// anything on someone else's.
export function buildCoverPreferencesPayload(
  preferences: Readonly<Record<string, string>>,
  libraryIds: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, url] of Object.entries(preferences)) {
    if (!libraryIds.has(id) || typeof url !== 'string') continue;
    if (url.length > MAX_COVER_URL_LENGTH || !/^https?:\/\/\S+$/.test(url)) continue;
    out[id] = url;
  }
  return out;
}

export interface DualRatingSettings {
  enabled: boolean;
  name1: string | null;
  name2: string | null;
  system2: RatingSystem;
  min2: number;
  max2: number;
}

export interface DualRatingPayload {
  name_1: string | null;
  name_2: string | null;
  system_2: RatingSystem;
  min_2: number;
  max_2: number;
}

/** null when the owner doesn't use a second rating (Settings > Preferencias). */
export function buildDualRatingPayload(settings: DualRatingSettings): DualRatingPayload | null {
  if (!settings.enabled || !(settings.min2 < settings.max2)) return null;
  const name = (value: string | null) => value?.trim().slice(0, 40) || null;
  return {
    name_1: name(settings.name1),
    name_2: name(settings.name2),
    system_2: settings.system2,
    min_2: settings.min2,
    max_2: settings.max2,
  };
}

/** The saved profile font id, or null when it isn't a plain font id. */
export function normalizeNameFont(font: unknown): string | null {
  return typeof font === 'string' && FONT_ID_RE.test(font) ? font : null;
}

/** Per reaction list; the Worker rejects more (413). */
export const MAX_SYNCED_CHARACTER_REACTIONS = 500;
const MAX_CHARACTER_NAME_LENGTH = 200;

export interface CharacterReactionPayloadEntry {
  external_id: string;
  name: string | null;
  /** Only a public http(s) portrait URL — a stored file path means nothing
   *  on someone else's machine. */
  image_url: string | null;
}

export type CharacterReactionsPayload = Record<CharacterReaction, CharacterReactionPayloadEntry[]>;

// The like / interest / dislike character lists in their saved order, ≤
// MAX_SYNCED_CHARACTER_REACTIONS each, with the name and portrait a viewer
// who doesn't have the character locally can still show. A character is
// kept in the first list it appears in (the app never has it in two).
export function buildCharacterReactionsPayload(groups: CharacterReactionGroups): CharacterReactionsPayload {
  const seen = new Set<string>();
  const out: CharacterReactionsPayload = { like: [], interest: [], dislike: [] };
  for (const reaction of CHARACTER_REACTIONS) {
    for (const item of groups[reaction] ?? []) {
      if (out[reaction].length >= MAX_SYNCED_CHARACTER_REACTIONS) break;
      if (!item.external_id || seen.has(item.external_id)) continue;
      seen.add(item.external_id);
      const name = item.name?.trim().slice(0, MAX_CHARACTER_NAME_LENGTH) || null;
      const image = item.image_url && item.image_url.length <= MAX_COVER_URL_LENGTH && /^https?:\/\/\S+$/.test(item.image_url)
        ? item.image_url
        : null;
      out[reaction].push({ external_id: item.external_id, name, image_url: image });
    }
  }
  return out;
}

/** Worker caps (validation.ts parseBingoYears). */
const MAX_BINGO_TITLE_LENGTH = 300;
const BINGO_MEDIA_TYPE_RE = /^[a-z0-9_-]{1,40}$/i;
const BINGO_EXTERNAL_ID_RE = /^[a-z0-9_-]{1,32}:\S+$/i;

export interface BingoPayloadCell {
  external_id: string;
  title: string;
  /** Only a public https cover — a local asset/data URL means nothing elsewhere. */
  cover_url: string | null;
  media_type: string;
}

export interface BingoPayloadYear {
  year: number;
  /** 1–49; `cells` (and the result's arrays) hold exactly this many entries. */
  size: number;
  cells: (BingoPayloadCell | null)[];
  /** Only once the board is in its result phase (from Dec 19 of `year`). */
  result?: { completed: boolean[]; scores: (number | null)[] };
}

function toBingoPayloadCell(cell: BingoCell): BingoPayloadCell | null {
  if (!cell || !BINGO_EXTERNAL_ID_RE.test(cell.external_id) || cell.external_id.length > 200) return null;
  const title = (cell.title?.trim() || cell.external_id).slice(0, MAX_BINGO_TITLE_LENGTH);
  if (!title || !BINGO_MEDIA_TYPE_RE.test(cell.media_type)) return null;
  const cover = cell.cover_url && cell.cover_url.length <= MAX_COVER_URL_LENGTH && /^https:\/\/\S+$/.test(cell.cover_url)
    ? cell.cover_url
    : null;
  return { external_id: cell.external_id, title, cover_url: cover, media_type: cell.media_type };
}

// The Yearly Bingo boards for the profile (the current and previous year's,
// newest first — whichever exist). A board in its result phase carries the
// owner's result, computed like their own profile tab does (lib/bingo), so
// viewers see the same completed cells and scores.
export function buildBingoPayload(
  boards: readonly YearlyBingoData[],
  library: readonly BingoLibraryRow[],
  now: Date,
): BingoPayloadYear[] {
  return [...boards]
    .filter(board => board.items.length >= MIN_BINGO_SIZE && board.items.length <= MAX_BINGO_SIZE)
    .sort((a, b) => b.year - a.year)
    .map(board => {
      const cells = board.items.map(toBingoPayloadCell);
      const out: BingoPayloadYear = { year: board.year, size: cells.length, cells };
      if (isBingoResultPhase(board.year, now)) {
        const result = computeBingoResult(board.items, library, board.year);
        out.result = {
          completed: result.cells.map((c, i) => cells[i] !== null && c.done),
          scores: result.cells.map((c, i) => (cells[i] !== null && c.rating !== null && c.rating >= 0 && c.rating <= 10 ? c.rating : null)),
        };
      }
      return out;
    });
}
