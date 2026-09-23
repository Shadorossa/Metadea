// Matching catalog anime to AnimeFillerList shows, and the per-entry
// episode offsets that place each entry inside the show's absolute
// numbering. Pure: the data comes from ./filler-data.ts.
//
// Titles are compared after normalisation (case, diacritics, punctuation,
// romaji long vowels such as "Shippuuden", a few well-known localized
// names) and, one step weaker, with season words stripped ("Season 2",
// "2nd Season", "Part 2", "The Final Season", "(2014)", trailing "II").
// Only those two kinds of match reach AUTO_LINK_CONFIDENCE; anything fuzzier
// (token overlap) is capped below it and only ranks the manual search.
//
// Offsets. AniList splits one AnimeFillerList show across several entries
// (Fairy Tail → Fairy Tail (2014) → Final Series). Walking the anime's
// PREQUEL/SEQUEL chain in order, each entry linked to a show starts where
// the previous entries linked to that same show ended; an entry that
// doesn't match on its own but directly continues its predecessor's show
// ("Bleach: Sennen Kessen-hen" after "Bleach") inherits the show. Every
// planned link is then checked against the show's real episode count
// (verifyPlannedLink) before it is stored.

import type { FillerIndexShow } from '../tauri/anime-filler';

export const AUTO_LINK_CONFIDENCE = 0.9;
const STRIPPED_MATCH = 0.95;
const COMPACT_MATCH = 0.97;
const ALIAS_MATCH = 0.93;
const CONTINUATION_MATCH = 0.9;
/** Fuzzy (token overlap) scores are scaled into [0, FUZZY_CEILING). */
const FUZZY_CEILING = 0.85;

// Localized / romaji names AnimeFillerList lists under another title,
// normalized on both sides.
const TITLE_ALIASES: Readonly<Record<string, string>> = {
  'meitantei conan': 'detective conan',
  'case closed': 'detective conan',
  'shingeki no kyojin': 'attack on titan',
  'boku no hero academia': 'my hero academia',
  'kimetsu no yaiba': 'demon slayer',
  'nanatsu no taizai': 'seven deadly sins',
  'shingeki no bahamut genesis': 'rage of bahamut genesis',
};

export function normalizeFillerTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/×/g, ' x ')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/uu/g, 'u')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

const SEASON_PATTERNS: readonly RegExp[] = [
  /\b(the )?final (season|series|chapters?|part|arc)\b/g,
  /\b(season|part|cour|series|chapter)\s*\d+\b/g,
  /\b\d+(st|nd|rd|th) (season|part|cour)\b/g,
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth) (season|part|cour)\b/g,
  /\bs\d{1,2}\b/g,
  /\b(19|20)\d{2}\b/g,
  /\btv\b/g,
  /\bkanketsu hen\b/g,
];

/** A normalized title without its season/part/year words. */
export function stripSeasonWords(normalized: string): string {
  let out = normalized;
  for (const pattern of SEASON_PATTERNS) out = out.replace(pattern, ' ');
  out = out.replace(/\s+/g, ' ').trim();
  // Trailing sequel markers: "Sword Art Online II", "Mob Psycho 100 2".
  out = out.replace(/ (ii|iii|iv|v|vi|vii|viii|ix)$/, '').replace(/ [2-9]$/, '');
  return out.trim();
}

function tokenDice(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

function aliasOf(normalized: string): string | undefined {
  return TITLE_ALIASES[normalized];
}

/** Similarity of a catalog title to an AnimeFillerList title, 0–1. */
export function fillerTitleScore(catalogTitle: string, fillerTitle: string): number {
  const a = normalizeFillerTitle(catalogTitle);
  const b = normalizeFillerTitle(fillerTitle);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.replace(/ /g, '') === b.replace(/ /g, '')) return COMPACT_MATCH;
  const sa = stripSeasonWords(a);
  const sb = stripSeasonWords(b);
  if (sa && sa === sb) return STRIPPED_MATCH;
  if (aliasOf(a) === b || (sa && aliasOf(sa) === sb)) return ALIAS_MATCH;
  return FUZZY_CEILING * tokenDice(sa || a, sb || b);
}

export interface FillerShowMatch {
  slug: string;
  title: string;
  confidence: number;
}

/** Best show for any of an entry's titles (romaji, English, native,
 *  synonyms). Ties prefer the show whose title is shorter (the more
 *  specific catalog title wins over a franchise umbrella). */
export function bestFillerMatch(titles: readonly string[], index: readonly FillerIndexShow[]): FillerShowMatch | null {
  let best: FillerShowMatch | null = null;
  const candidates = titles.filter(title => !!title?.trim());
  for (const show of index) {
    let score = 0;
    for (const title of candidates) score = Math.max(score, fillerTitleScore(title, show.title));
    if (score <= 0) continue;
    if (!best || score > best.confidence || (score === best.confidence && show.title.length < best.title.length)) {
      best = { slug: show.slug, title: show.title, confidence: score };
    }
  }
  return best;
}

/** Ranked hits for the manual link popover's search box. */
export function searchFillerIndex(query: string, index: readonly FillerIndexShow[], limit = 20): FillerIndexShow[] {
  const q = normalizeFillerTitle(query);
  if (!q) return index.slice(0, limit);
  return index
    .map(show => {
      const title = normalizeFillerTitle(show.title);
      const contains = title.includes(q) ? (title.startsWith(q) ? 2 : 1) : 0;
      return { show, rank: contains + fillerTitleScore(query, show.title) };
    })
    .filter(hit => hit.rank > 0.3)
    .sort((a, b) => b.rank - a.rank || a.show.title.localeCompare(b.show.title))
    .slice(0, limit)
    .map(hit => hit.show);
}

// ── Chain → links ───────────────────────────────────────────────────────────

export interface FillerChainEntry {
  externalId: string;
  titles: string[];
  totalCount: number;
  format?: string;
}

export interface PlannedFillerLink {
  externalId: string;
  slug: string;
  episodeOffset: number;
  confidence: number;
}

/** Same rule as the episode list's chain offset (anime-tmdb-match.ts):
 *  movies and one-off specials are not part of the numbered TV run. */
function isPartOfEpisodeRun(entry: FillerChainEntry): boolean {
  const format = entry.format?.toUpperCase();
  return format !== 'MOVIE' && format !== 'MUSIC' && !(format === 'SPECIAL' && entry.totalCount <= 1);
}

/** Only a real season (not an OVA / special that happens to share the
 *  franchise name) may inherit its predecessor's show. */
function isSeasonFormat(entry: FillerChainEntry): boolean {
  const format = entry.format?.toUpperCase();
  return !format || format === 'TV' || format === 'TV_SHORT' || format === 'ONA';
}

function continuesTitle(entry: FillerChainEntry, showTitle: string): boolean {
  const show = stripSeasonWords(normalizeFillerTitle(showTitle));
  if (!show) return false;
  return entry.titles.some(title => {
    const own = normalizeFillerTitle(title);
    return own === show || own.startsWith(`${show} `);
  });
}

/**
 * Links for every chain entry that belongs to an AnimeFillerList show, with
 * offsets accumulated per show along the chain (prequels first). Entries
 * below the confidence threshold that don't continue their predecessor's
 * show get no link.
 */
export function planChainFillerLinks(chain: readonly FillerChainEntry[], index: readonly FillerIndexShow[]): PlannedFillerLink[] {
  const plans: PlannedFillerLink[] = [];
  const nextOffsetBySlug = new Map<string, number>();
  let previous = null as FillerShowMatch | null;
  for (const entry of chain) {
    if (!isPartOfEpisodeRun(entry)) continue;
    const own = bestFillerMatch(entry.titles, index);
    let chosen: FillerShowMatch | null = null;
    if (own && own.confidence >= AUTO_LINK_CONFIDENCE) {
      chosen = own;
    } else if (previous && isSeasonFormat(entry) && continuesTitle(entry, previous.title)) {
      chosen = { slug: previous.slug, title: previous.title, confidence: Math.min(previous.confidence, CONTINUATION_MATCH) };
    }
    if (!chosen) {
      previous = null;
      continue;
    }
    const offset = nextOffsetBySlug.get(chosen.slug) ?? 0;
    plans.push({ externalId: entry.externalId, slug: chosen.slug, episodeOffset: offset, confidence: chosen.confidence });
    nextOffsetBySlug.set(chosen.slug, offset + Math.max(0, entry.totalCount || 0));
    previous = chosen;
  }
  return plans;
}

/**
 * A planned link is only kept when it fits the show: its first episode must
 * exist, and a finished entry must end within the show's episode count
 * (two episodes of slack for recap/numbering quirks). An entry still airing
 * may announce more episodes than the show lists yet.
 */
export function verifyPlannedLink(
  plan: Pick<PlannedFillerLink, 'episodeOffset'>,
  entryTotal: number,
  showLastEpisode: number,
  entryAiring: boolean,
): boolean {
  if (showLastEpisode <= 0 || plan.episodeOffset >= showLastEpisode) return false;
  if (entryAiring || !entryTotal) return true;
  return plan.episodeOffset + entryTotal <= showLastEpisode + 2;
}
