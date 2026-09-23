// What Big Picture shows: every playable thing Local already knows about —
// scanned installs, emulated ROMs and the in-progress/planned works of each
// media tab — flattened into one item shape, then split into the tab strip
// (All, Recently played, Installed games, one tab per emulated platform,
// the media kinds, Favourites). Pure: see categories.test.ts.
import type { CategoryId } from '../local/platforms';

export type BigPictureMediaKind = 'anime' | 'series' | 'movies' | 'manga' | 'lnovel' | 'books';

export interface BigPictureProgress {
  current: number;
  total: number | null;
  /** Episodes for video, chapters for reading. */
  unit: 'episode' | 'chapter';
}

export interface BigPictureItem {
  /** Unique across every kind — `game:<launcher>:<id>` / `media:<external id>`. */
  key: string;
  kind: 'game' | 'media';
  title: string;
  /** Portrait cover (already a loadable URL). */
  cover: string | null;
  /** Wide art for the background/detail pane; falls back to the cover. */
  hero: string | null;
  /** The Local tab the item lives under (what a resume request targets). */
  category: CategoryId;
  mediaKind?: BigPictureMediaKind;
  /** Emulator platform id ("ps2", "switch") for a ROM. */
  romPlatform?: string;
  /** False for an owned-but-not-installed store game (Steam lists those). */
  installed: boolean;
  favorite: boolean;
  /** Unix seconds of the last play/read/watch, when known. */
  lastActivity: number | null;
  playtimeMinutes?: number;
  progress?: BigPictureProgress;
  status?: string;
  externalId?: string;
}

export type BigPictureTabKind = 'all' | 'recent' | 'installed' | 'emulated' | 'media' | 'favorites';

export interface BigPictureTab {
  id: string;
  kind: BigPictureTabKind;
  /** Emulated tabs: the platform id. */
  platform?: string;
  mediaKind?: BigPictureMediaKind;
  items: BigPictureItem[];
}

export const RECENT_TAB_LIMIT = 30;

const MEDIA_KIND_ORDER: readonly BigPictureMediaKind[] = ['anime', 'series', 'movies', 'manga', 'lnovel', 'books'];

const MEDIA_KIND_BY_CATEGORY: Partial<Record<CategoryId, BigPictureMediaKind>> = {
  anime: 'anime',
  series: 'series',
  movies: 'movies',
  manga: 'manga',
  comics: 'manga',
  books: 'books',
  'light-novel': 'lnovel',
};

/** Media kind a Local category groups under in Big Picture (comics join
 *  manga; light novels have their own tab, apart from books), or undefined
 *  for game categories. */
export function mediaKindForCategory(category: CategoryId): BigPictureMediaKind | undefined {
  return MEDIA_KIND_BY_CATEGORY[category];
}

function byTitle(a: BigPictureItem, b: BigPictureItem): number {
  return a.title.localeCompare(b.title);
}

function byRecent(a: BigPictureItem, b: BigPictureItem): number {
  return (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || byTitle(a, b);
}

export interface DeriveTabsOptions {
  recentLimit?: number;
  /** Order of the emulated platform tabs (e.g. the emulator catalog order);
   *  unknown platforms follow alphabetically. */
  platformOrder?: readonly string[];
}

/** The tab strip for `items`. "All" is always present; every other tab only
 *  when it has something in it. Items inside a tab are alphabetical, except
 *  Recently played (most recent first). */
export function deriveBigPictureTabs(items: readonly BigPictureItem[], options: DeriveTabsOptions = {}): BigPictureTab[] {
  const recentLimit = options.recentLimit ?? RECENT_TAB_LIMIT;
  const sorted = [...items].sort(byTitle);
  const tabs: BigPictureTab[] = [{ id: 'all', kind: 'all', items: sorted }];

  const recent = items.filter(i => (i.lastActivity ?? 0) > 0).sort(byRecent).slice(0, recentLimit);
  if (recent.length > 0) tabs.push({ id: 'recent', kind: 'recent', items: recent });

  const installed = sorted.filter(i => i.kind === 'game' && !i.romPlatform && i.installed);
  if (installed.length > 0) tabs.push({ id: 'installed', kind: 'installed', items: installed });

  const byPlatform = new Map<string, BigPictureItem[]>();
  for (const item of sorted) {
    if (item.kind !== 'game' || !item.romPlatform) continue;
    const list = byPlatform.get(item.romPlatform);
    if (list) list.push(item); else byPlatform.set(item.romPlatform, [item]);
  }
  const order = options.platformOrder ?? [];
  const rank = (platform: string) => {
    const index = order.indexOf(platform);
    return index === -1 ? order.length : index;
  };
  const platforms = [...byPlatform.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const platform of platforms) {
    tabs.push({ id: `emu:${platform}`, kind: 'emulated', platform, items: byPlatform.get(platform) ?? [] });
  }

  for (const mediaKind of MEDIA_KIND_ORDER) {
    const list = sorted.filter(i => i.kind === 'media' && i.mediaKind === mediaKind);
    if (list.length > 0) tabs.push({ id: `media:${mediaKind}`, kind: 'media', mediaKind, items: list });
  }

  const favorites = sorted.filter(i => i.favorite);
  if (favorites.length > 0) tabs.push({ id: 'favorites', kind: 'favorites', items: favorites });

  return tabs;
}

/** Case/accent-insensitive title match for the on-screen-keyboard search. */
export function searchBigPictureItems(items: readonly BigPictureItem[], query: string, limit = 40): BigPictureItem[] {
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const q = fold(query.trim());
  if (!q) return [];
  const starts: BigPictureItem[] = [];
  const contains: BigPictureItem[] = [];
  for (const item of [...items].sort(byTitle)) {
    const title = fold(item.title);
    if (title.startsWith(q)) starts.push(item);
    else if (title.includes(q)) contains.push(item);
  }
  return [...starts, ...contains].slice(0, limit);
}
