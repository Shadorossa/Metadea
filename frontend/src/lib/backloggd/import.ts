// "Import from Backloggd": a Toolkittd CSV export → library entries. Each
// row's IGDB slug is resolved through igdb_games_by_slugs (the user's IGDB
// keys) to `game:<id>` / `vnovel:<id>`; rows IGDB doesn't know come back as
// `unmatched`. An existing entry keeps whatever the export doesn't have:
// the export only adds information (status, rating and dates when set,
// liked → favourite, mastered → platinum, more playtime, a review where
// there were no notes), it never clears anything.
import { getAllLibraryEntries, saveLibraryEntry, type LibraryEntry } from '../tauri/library';
import { getCatalogEntriesByIds, saveCatalogEntry, type MediaCatalogEntry } from '../tauri/catalog';
import { igdbGamesBySlugs, type IgdbSlugMatch } from '../tauri/igdb';
import type { ImportProgress } from '../anilist/import';
import type { BackloggdGame } from './toolkittd-csv';

export interface BackloggdImportItem {
  externalId: string;
  type: 'game' | 'vnovel';
  game: BackloggdGame;
  match: IgdbSlugMatch;
}

export interface BackloggdImportPlan {
  items: BackloggdImportItem[];
  unmatched: BackloggdGame[];
}

export interface BackloggdImportResult {
  updated: number;
  added: number;
  failed: number;
  unmatched: BackloggdGame[];
}

/** Library status for a Backloggd row: playing wins over played (a replay). */
export function backloggdStatus(game: BackloggdGame): string {
  if (game.playing) return 'playing';
  if (game.played) return 'completed';
  return 'planning';
}

// Pure: rows + IGDB answers → what to write and what nothing matched. A
// work already in the library under its game/vnovel sibling keeps that id.
export function planBackloggdImport(
  games: BackloggdGame[],
  matches: IgdbSlugMatch[],
  libraryIds: ReadonlySet<string>,
): BackloggdImportPlan {
  const bySlug = new Map(matches.map(match => [match.slug, match]));
  const items: BackloggdImportItem[] = [];
  const unmatched: BackloggdGame[] = [];
  const seen = new Set<string>();
  for (const game of games) {
    const match = game.slug ? bySlug.get(game.slug) : undefined;
    if (!match) { unmatched.push(game); continue; }
    const preferred = match.is_vn ? 'vnovel' : 'game';
    const sibling = preferred === 'game' ? 'vnovel' : 'game';
    const type = !libraryIds.has(`${preferred}:${match.id}`) && libraryIds.has(`${sibling}:${match.id}`) ? sibling : preferred;
    const externalId = `${type}:${match.id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    items.push({ externalId, type, game, match });
  }
  return { items, unmatched };
}

/** `existing` with what the export adds; the entry to save for a new one. */
export function mergeBackloggdEntry(existing: LibraryEntry | undefined, item: BackloggdImportItem, now: string): LibraryEntry {
  const { game } = item;
  const base: LibraryEntry = existing ?? {
    id: '', user_id: 'local', external_id: item.externalId, type: item.type, status: null,
    rating: null, rating_2: null, progress: 0, progress_2: 0, minutes_spent: 0, is_favorite: 0, is_platinum: 0,
    tags: [], notes: null, added_at: now, updated_at: now, selected_platform: null, selected_version: null,
    started_at: null, finished_at: null,
  };
  return {
    ...base,
    status: existing && !game.played && !game.playing && existing.status ? existing.status : backloggdStatus(game),
    rating: game.rating ?? base.rating,
    started_at: game.startDate ?? base.started_at,
    finished_at: game.finishDate ?? base.finished_at,
    is_favorite: game.liked ? 1 : base.is_favorite,
    is_platinum: game.mastered ? 1 : base.is_platinum,
    // A game's progress is its hours (2 decimals, game_sessions.rs
    // progress_hours); the editor rebuilds minutes_spent from it on save.
    minutes_spent: Math.max(base.minutes_spent ?? 0, game.minutes),
    progress: Math.max(base.progress ?? 0, Math.round((game.minutes / 60) * 100) / 100),
    notes: base.notes?.trim() ? base.notes : (game.review ?? base.notes),
  };
}

const TRACKED: Array<keyof LibraryEntry> = [
  'status', 'rating', 'started_at', 'finished_at', 'is_favorite', 'is_platinum', 'minutes_spent', 'progress', 'notes',
];

function catalogStub(item: BackloggdImportItem, now: string): MediaCatalogEntry {
  return {
    id: item.externalId,
    external_id: item.externalId,
    type: item.type,
    source: 'igdb',
    title_main: item.match.name || item.game.name,
    cover_url: item.match.cover_url,
    release_year: item.match.release_year,
    release_month: null,
    release_day: null,
    score_global: null,
    created_at: now,
    updated_at: now,
  };
}

export async function importBackloggdGames(
  games: BackloggdGame[],
  onProgress: (progress: ImportProgress) => void = () => {},
): Promise<BackloggdImportResult> {
  onProgress({ current: 0, total: games.length, status: 'loading' });
  const slugs = games.flatMap(game => (game.slug ? [game.slug] : []));
  const [matches, library] = await Promise.all([igdbGamesBySlugs(slugs), getAllLibraryEntries()]);
  const libraryById = new Map(library.map(entry => [entry.external_id, entry]));
  const { items, unmatched } = planBackloggdImport(games, matches, new Set(libraryById.keys()));
  const cataloged = new Set((await getCatalogEntriesByIds(items.map(item => item.externalId))).map(row => row.external_id));

  let updated = 0;
  let added = 0;
  let failed = 0;
  for (const [index, item] of items.entries()) {
    onProgress({ current: index, total: items.length, status: 'importing', message: item.match.name });
    const now = new Date().toISOString();
    const existing = libraryById.get(item.externalId);
    const merged = mergeBackloggdEntry(existing, item, now);
    if (existing && TRACKED.every(field => (existing[field] ?? null) === (merged[field] ?? null))) continue;
    try {
      if (!cataloged.has(item.externalId)) await saveCatalogEntry(catalogStub(item, now));
      await saveLibraryEntry({ ...merged, updated_at: now });
      if (existing) updated++; else added++;
    } catch (err) {
      failed++;
      console.error(`Failed to import ${item.externalId}:`, err);
    }
  }
  onProgress({ current: items.length, total: items.length, status: 'done', failed });
  return { updated, added, failed, unmatched };
}
