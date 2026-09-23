// Which works Ambient mode shows, and with which wallpaper. Pure: the IPC
// side lives in ambient-slide-source.ts.
//
// Only landscape wallpapers (src-tauri/src/wallpapers.rs) — never a portrait
// cover. Candidates, best first: favourites, then works in progress, then
// completed works rated HIGH_RATING or more, each tier shuffled; then the
// rest of the library, shuffled, used only to top a thin slideshow up to
// MIN_AMBIENT_SLIDES. Wallpapers are resolved in batches down that list
// until MAX_AMBIENT_SLIDES have one (or the list / lookup budget runs out),
// and the result is shuffled so tiers don't play in blocks.
import { isInProgressStatus } from '../media/media-types';

export const MAX_AMBIENT_SLIDES = 40;
export const MIN_AMBIENT_SLIDES = 12;
/** Narrower images look soft full-screen (checked again on the loaded image). */
export const MIN_WALLPAPER_WIDTH = 1280;
/** DB ratings are 0–10 whatever the display system. */
const HIGH_RATING = 8;
/** Ids per resolve call, and the most ids one screensaver start looks up. */
const WALLPAPER_BATCH = 50;
const MAX_WALLPAPER_LOOKUPS = 250;
/** Work types wallpapers.rs has a source for (books and comics have none). */
const WALLPAPER_TYPES = new Set(['movie', 'series', 'game', 'vnovel', 'anime', 'manga']);

export type Rng = () => number;

export interface AmbientLibraryEntry {
  external_id: string;
  type: string;
  status: string | null;
  rating: number | null;
  is_favorite: number;
}

export interface AmbientCatalogRow {
  external_id: string;
  type: string;
  title_main: string | null;
  title_english?: string | null;
  release_year: number | null;
}

export interface AmbientWork {
  externalId: string;
  type: string;
  title: string;
  year: number | null;
}

/** `banner` is an AniList banner (~1900×400): centre-cropped, gentler
 *  motion and a vignette. Everything else is a real 16:9-ish wallpaper. */
export type AmbientWallpaperKind = 'backdrop' | 'artwork' | 'screenshot' | 'banner';

export interface AmbientWallpaper {
  url: string;
  kind: AmbientWallpaperKind;
}

export interface AmbientSlide {
  work: AmbientWork;
  wallpaper: AmbientWallpaper;
}

/** One answer of `resolve_wallpapers`. */
export interface WallpaperAnswer {
  external_id: string;
  url: string | null;
  kind: string | null;
}

export interface RankedAmbientWorks {
  /** Favourites, in progress, high-scored completed — in that order. */
  priority: AmbientWork[];
  /** The rest of the library. */
  rest: AmbientWork[];
}

export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function hasWallpaperSource(externalId: string): boolean {
  return WALLPAPER_TYPES.has(externalId.split(':', 1)[0]);
}

/** A loaded image is good enough to fill the screen: wider than tall and at
 *  least MIN_WALLPAPER_WIDTH wide. */
export function isUsableWallpaper(width: number, height: number): boolean {
  return height > 0 && width > height && width >= MIN_WALLPAPER_WIDTH;
}

type Tier = 0 | 1 | 2 | 3;

function tierOf(entry: AmbientLibraryEntry): Tier {
  if (entry.is_favorite === 1) return 0;
  if (isInProgressStatus(entry.status)) return 1;
  if (entry.status === 'completed' && (entry.rating ?? 0) >= HIGH_RATING) return 2;
  return 3;
}

function toWork(entry: AmbientLibraryEntry, row: AmbientCatalogRow): AmbientWork | null {
  const title = row.title_main || row.title_english;
  if (!title) return null;
  return { externalId: entry.external_id, type: row.type || entry.type, title, year: row.release_year ?? null };
}

export function rankAmbientWorks(
  entries: readonly AmbientLibraryEntry[],
  catalog: ReadonlyMap<string, AmbientCatalogRow>,
  rng: Rng = Math.random,
): RankedAmbientWorks {
  const tiers: AmbientWork[][] = [[], [], [], []];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.external_id) || !hasWallpaperSource(entry.external_id)) continue;
    const row = catalog.get(entry.external_id);
    if (!row) continue;
    const work = toWork(entry, row);
    if (!work) continue;
    seen.add(entry.external_id);
    tiers[tierOf(entry)].push(work);
  }
  return {
    priority: tiers.slice(0, 3).flatMap(tier => shuffled(tier, rng)),
    rest: shuffled(tiers[3], rng),
  };
}

export function toWallpaper(answer: WallpaperAnswer | undefined): AmbientWallpaper | null {
  if (!answer?.url) return null;
  const kind = answer.kind;
  if (kind !== 'backdrop' && kind !== 'artwork' && kind !== 'screenshot' && kind !== 'banner') return null;
  return { url: answer.url, kind };
}

export interface CollectOptions {
  rng?: Rng;
  max?: number;
  min?: number;
  batchSize?: number;
  maxLookups?: number;
}

/** Walks the ranked works in batches, asking `resolve` for their wallpapers,
 *  and keeps the ones that have one (each image once — AniList seasons that
 *  map to one TMDB show share a backdrop). Priority works fill up to `max`;
 *  the rest only top up to `min`. A failed batch just counts as "none". */
export async function collectAmbientSlides(
  ranked: RankedAmbientWorks,
  resolve: (externalIds: string[]) => Promise<WallpaperAnswer[]>,
  options: CollectOptions = {},
): Promise<AmbientSlide[]> {
  const rng = options.rng ?? Math.random;
  const max = options.max ?? MAX_AMBIENT_SLIDES;
  const floor = Math.min(max, options.min ?? MIN_AMBIENT_SLIDES);
  const batchSize = options.batchSize ?? WALLPAPER_BATCH;
  let lookupsLeft = options.maxLookups ?? MAX_WALLPAPER_LOOKUPS;
  const picked: AmbientSlide[] = [];
  const usedUrls = new Set<string>();

  const fill = async (works: AmbientWork[], limit: number) => {
    for (let start = 0; start < works.length && picked.length < limit && lookupsLeft > 0; start += batchSize) {
      const batch = works.slice(start, start + Math.min(batchSize, lookupsLeft));
      lookupsLeft -= batch.length;
      const answers = await resolve(batch.map(work => work.externalId)).catch(() => [] as WallpaperAnswer[]);
      const byId = new Map(answers.map(answer => [answer.external_id, answer]));
      for (const work of batch) {
        if (picked.length >= limit) break;
        const wallpaper = toWallpaper(byId.get(work.externalId));
        if (!wallpaper || usedUrls.has(wallpaper.url)) continue;
        usedUrls.add(wallpaper.url);
        picked.push({ work, wallpaper });
      }
    }
  };

  await fill(ranked.priority, max);
  await fill(ranked.rest, floor);
  return shuffled(picked, rng);
}
