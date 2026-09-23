import { tauriRun, tauriTry } from './bridge';

// ── Anime filler lists (src-tauri/src/anime_filler) ─────────────────────────
// AnimeFillerList.com, cached in SQLite. Reads degrade to "nothing" (the
// feature hides); link writes propagate their error.

export interface FillerIndexShow {
  slug: string;
  title: string;
}

/** One show's categories in AnimeFillerList's absolute numbering. Manga
 *  canon is every episode up to `lastEpisode` not listed elsewhere. */
export interface FillerShowData {
  slug: string;
  title: string;
  fetchedAt: number | null;
  isAiring: boolean;
  lastEpisode: number;
  filler: number[];
  mixed: number[];
  animeCanon: number[];
}

export interface FillerLinkRow {
  externalId: string;
  slug: string;
  /** AnimeFillerList number of this entry's episode 1, minus one. */
  episodeOffset: number;
  confidence: number;
  manual: boolean;
}

export interface FillerInfoRow {
  link: FillerLinkRow;
  show: FillerShowData | null;
}

/** The cached show index; refreshed weekly (or when `force`) in Rust. */
export function getFillerIndex(force = false): Promise<FillerIndexShow[]> {
  return tauriTry<FillerIndexShow[]>('filler_get_index', [], { force });
}

/** One show's data, fetched when never fetched / airing and a week old /
 *  forced. `null` when unavailable (offline, backoff, page changed). */
export function ensureFillerShow(slug: string, airing: boolean, force = false): Promise<FillerShowData | null> {
  return tauriTry<FillerShowData | null>('filler_ensure_show', null, { slug, airing, force });
}

/** Cached links + show data for the given entries, or every link when
 *  `externalIds` is omitted. Never touches the network. */
export function getFillerInfo(externalIds?: string[]): Promise<FillerInfoRow[]> {
  return tauriTry<FillerInfoRow[]>('filler_get_info', [], externalIds ? { externalIds } : {});
}

export function setFillerLink(link: FillerLinkRow): Promise<void> {
  return tauriRun('filler_set_link', {
    externalId: link.externalId,
    slug: link.slug,
    episodeOffset: link.episodeOffset,
    confidence: link.confidence,
    manual: link.manual,
  });
}

export function removeFillerLink(externalId: string): Promise<void> {
  return tauriRun('filler_remove_link', { externalId });
}
