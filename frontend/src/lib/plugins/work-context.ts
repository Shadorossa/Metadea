// The work a media page shows, as plugins see it (`workActions`,
// `workPanels`, source matching): ids and titles only.
import type { SourceSearchItem } from './plugin-results';

export interface PluginWorkContext {
  externalId: string;
  type: string;
  /** Main title first, then English/romaji/native variants, deduplicated. */
  titles: string[];
  anilistId: number | null;
  malId: number | null;
  year: number | null;
}

/** AniList catalog ids are `anime:<n>`, `manga:<n>`, `lnovel:<n>`. */
export function anilistIdOf(externalId: string): number | null {
  const match = externalId.match(/^(anime|manga|lnovel):(\d+)$/);
  return match ? Number(match[2]) : null;
}

export function buildWorkContext(input: {
  externalId: string;
  type: string;
  titleMain: string;
  titleEnglish?: string;
  titleRomaji?: string;
  titleNative?: string;
  releaseYear?: number;
  malId?: number | null;
}): PluginWorkContext {
  const titles: string[] = [];
  for (const title of [input.titleMain, input.titleEnglish, input.titleRomaji, input.titleNative]) {
    const clean = title?.trim();
    if (clean && !titles.includes(clean)) titles.push(clean);
  }
  return {
    externalId: input.externalId,
    type: input.type,
    titles,
    anilistId: anilistIdOf(input.externalId),
    malId: input.malId ?? null,
    year: input.releaseYear ?? null,
  };
}

/** Lower-case, accents stripped, punctuation collapsed. */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type MatchReason = 'anilistId' | 'malId' | 'title';

/**
 * The search result that is this work, or null when none is certain enough
 * (the user then picks one). An AniList id match wins, then a MAL id match,
 * then an exact normalised title match — of the same type when possible,
 * and within a year of the work's own when both have one.
 */
export function pickBestMatch(items: SourceSearchItem[], work: PluginWorkContext): { item: SourceSearchItem; reason: MatchReason } | null {
  if (work.anilistId != null) {
    const item = items.find(i => i.anilistId === work.anilistId);
    if (item) return { item, reason: 'anilistId' };
  }
  if (work.malId != null) {
    const item = items.find(i => i.malId === work.malId);
    if (item) return { item, reason: 'malId' };
  }
  const titles = new Set(work.titles.map(normalizeTitle).filter(Boolean));
  const candidates = items.filter(i => titles.has(normalizeTitle(i.title)))
    .filter(i => work.year == null || i.year == null || Math.abs(i.year - work.year) <= 1);
  const item = candidates.find(i => i.type === work.type) ?? candidates[0];
  return item ? { item, reason: 'title' } : null;
}
