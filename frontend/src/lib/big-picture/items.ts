// Local's own data -> Big Picture items (see categories.ts). Pure: every
// lookup LocalLibrary already owns (cover cache, catalog titles, library
// rows) is passed in, nothing is read here.
import type { LocalGame } from '../tauri/local-library';
import type { LibraryEntry } from '../tauri/library';
import type { CatalogEntryLike } from '../tauri/catalog';
import type { LocalMediaItem } from '../local/local-media-item';
import { LOCAL_CATEGORY_BY_MEDIA_TYPE } from '../local/platforms';
import { isInProgressStatus, isReadingType } from '../media/media-types';
import { toMediumCover } from '../media/small-cover';
import { effectiveEpisodeTotal, effectiveProgress } from '../anime/filler';
import { getLoadedFillerInfo } from '../anime/filler-store';
import { mediaKindForCategory, type BigPictureItem } from './categories';

export interface GameItemContext {
  /** coverCache[app_id] — asset:// URLs of the downloaded cover/banner. */
  art: (game: LocalGame) => { cover?: string; banner?: string } | undefined;
  /** Candidate catalog ids of the install (candidateExternalIdsForGame). */
  candidateIds: (game: LocalGame) => string[];
  catalogById: ReadonlyMap<string, CatalogEntryLike>;
  entryById: ReadonlyMap<string, LibraryEntry>;
}

export function isRomGame(game: LocalGame): boolean {
  const isExe = !!game.install_path?.toLowerCase().endsWith('.exe');
  return !isExe && !!game.rom_platform && !!game.install_path;
}

export function gameItemKey(game: LocalGame): string {
  return `game:${game.launcher}:${game.app_id ?? game.install_path ?? game.name}`;
}

export function buildGameItem(game: LocalGame, ctx: GameItemContext): BigPictureItem {
  const ids = ctx.candidateIds(game);
  const trackedId = ids.find(id => ctx.entryById.has(id));
  const entry = trackedId ? ctx.entryById.get(trackedId) : undefined;
  const catalog = ids.map(id => ctx.catalogById.get(id)).find(Boolean);
  const art = ctx.art(game);
  const catalogCover = catalog?.cover_url ? toMediumCover(catalog.cover_url) : null;
  const cover = art?.cover ?? catalogCover;
  const rom = isRomGame(game);
  const playtime = game.playtime_minutes ?? (entry ? (entry.minutes_spent || Math.round((entry.progress ?? 0) * 60)) : undefined);
  return {
    key: gameItemKey(game),
    kind: 'game',
    // A Steam install keeps its store name (same rule as GameDetailPanel);
    // a ROM dump name gives way to the linked catalog title.
    title: game.launcher === 'steam' ? game.name : (catalog?.title_main || game.name),
    cover,
    hero: art?.banner ?? cover,
    category: 'videojuegos',
    romPlatform: rom ? game.rom_platform : undefined,
    installed: game.installed !== false,
    favorite: entry?.is_favorite === 1,
    lastActivity: game.last_played && game.last_played > 0 ? game.last_played : null,
    playtimeMinutes: playtime,
    status: entry?.status ?? undefined,
    externalId: trackedId ?? ids[0],
  };
}

// SQLite CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC) -> unix seconds.
export function sqliteTimestampToUnix(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** A media tab's item, or null for a type Big Picture does not show
 *  (games and visual novels come from the scanned installs instead). */
export function buildMediaItem(item: LocalMediaItem): BigPictureItem | null {
  const type = item.libraryEntry.type;
  const category = LOCAL_CATEGORY_BY_MEDIA_TYPE[type];
  const mediaKind = category ? mediaKindForCategory(category) : undefined;
  if (!category || !mediaKind) return null;
  const reading = isReadingType(type);
  const inProgress = isInProgressStatus(item.status);
  const fillerInfo = type === 'anime' ? getLoadedFillerInfo(item.externalId) : undefined;
  return {
    key: `media:${item.externalId}`,
    kind: 'media',
    title: item.title,
    cover: item.cover ? toMediumCover(item.cover) : null,
    hero: item.cover,
    category,
    mediaKind,
    installed: true,
    favorite: item.libraryEntry.is_favorite === 1,
    // Only works actually being watched/read count as recent activity — an
    // edit to a planned entry also bumps updated_at.
    lastActivity: inProgress ? sqliteTimestampToUnix(item.libraryEntry.updated_at) : null,
    // Anime set to "Filler: Skipped" shows canon counts (lib/anime/filler.ts).
    progress: {
      current: fillerInfo ? effectiveProgress({ ...item.libraryEntry, progress: item.progress ?? 0 }, fillerInfo, item.catalogEntry?.total_count) : item.progress ?? 0,
      total: effectiveEpisodeTotal(item.libraryEntry, fillerInfo, item.catalogEntry?.total_count),
      unit: reading ? 'chapter' : 'episode',
    },
    status: item.status,
    externalId: item.externalId,
  };
}
