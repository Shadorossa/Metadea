// Taste compatibility score between the viewer and a visited profile. Pure:
// no IPC, no DOM. Inputs are the counts and rating pairs
// get_taste_compatibility returns (ratings already normalised to 0-1) plus
// optional library signals computed here from both whole libraries
// (librarySignals). There is always a score, 0-100 — evidence decides how
// much each component weighs, never whether a number is shown:
//
//   base  = (1 - p)·Σ wᵢ·xᵢ / Σ wᵢ  +  p·P      (i over R, O, S, G, H)
//   score = round(100 · base) + F, clamped to 0-100
//
// R — rating agreement: weighted mean of 1 - |a - b| over both-rated works,
//     rescaled so 0.5 (what unrelated ratings average) maps to 0. Works both
//     rated ≥ 0.8 weigh more, and so do strong disagreements (|a - b| ≥ 0.5).
// O — library overlap: log(1 + shared) / log(1 + union) over completed-or-
//     rated works (diminishing returns; big libraries don't win by size).
// S — status similarity over works both have: both completed / dropped /
//     planning the same work agree; completed vs dropped disagrees.
// G — genres: cosine similarity of engagement-weighted genre vectors over
//     each whole library. A work adds to each of its genres
//     status weight (completed 1 … dropped 0.15) × rating factor
//     (0.2 + 1.3·r², unrated 0.8), so loved genres dominate and genres
//     someone rates low barely count — meaningful even with zero overlap.
// H — hours per medium: histogram intersection Σ min(pₜ, qₜ) of each side's
//     share of hours per media type, with the Stats tab's own hours
//     (computeTypeBreakdown), so a gamer and an anime-only viewer score ~0.
// P — the rest of the libraries (non-shared works): cosine similarity of
//     "profile vectors" built from ALL works — media types, catalog formats
//     and release decades — blended 75/25 with a rating-level term,
//     1 - |mean rating of your non-shared works - theirs| / 0.35, when both
//     sides rated ≥ 3 works the other doesn't have. Its share p is capped:
//     p = 0.12 · n / (n + 10), n = the smaller side's non-shared count.
// F — shared favourites: +2 per work in both users' favourites, max +8.
//
// Weights adapt to evidence: with c = bothRated / (bothRated + 6), rating
// agreement weighs 4·c and dominates as the rated overlap grows (ratings
// are the most direct taste signal: same titles rated in opposition must
// read as low); the other components shrink as it does — overlap
// 0.5·(1 - 0.6c), status 1·cₛ·(1 - 0.7c) with cₛ = statusShared /
// (statusShared + 5), genres 1.3·(1 - 0.5c), hours 0.8·cₕ·(1 - 0.7c) with
// cₕ = h / (h + 10) for h the smaller side's total hours. A component
// without evidence weighs 0.
import type { CatalogSummary, LibraryEntry } from '../tauri';
import type { TasteCompatibilityData, TasteRatingPair } from '../tauri/social-profile';
import { computeTypeBreakdown } from '../profile/stats-calculators';

const RATING_CONFIDENCE_K = 6;
const RATING_WEIGHT = 4;
const OVERLAP_WEIGHT = 0.5;
const STATUS_WEIGHT = 1;
const STATUS_CONFIDENCE_K = 5;
const GENRE_WEIGHT = 1.3;
const HOURS_WEIGHT = 0.8;
const HOURS_CONFIDENCE_K = 10;
/** Most of the base score the non-shared works (P) can ever carry. */
export const PROFILE_SHARE_MAX = 0.12;
const PROFILE_CONFIDENCE_K = 10;
/** Within P: the rating-level term's share when both sides have one. */
const PROFILE_RATING_SHARE = 0.25;
/** Mean-rating gap (0-1 scale) at which the rating-level term reaches 0. */
const PROFILE_RATING_GAP = 0.35;
const PROFILE_MIN_RATED = 3;
const HIGH_RATING = 0.8;
const LOVED_RATING = 0.9;
const HIGH_AGREEMENT_WEIGHT = 1.5;
const STRONG_DISAGREEMENT = 0.5;
const STRONG_DISAGREEMENT_WEIGHT = 1.5;
const FAVORITE_BONUS_EACH = 2;
export const FAVORITE_BONUS_MAX = 8;
const MAX_BOTH_LOVED = 12;
const MAX_DISAGREEMENTS = 5;
const MAX_SHARED_GENRES = 8;
/** Share of a side's genre weight a genre needs to count as "loved". */
const SHARED_GENRE_MIN_SHARE = 0.03;
/** Score from which the profile's heart button shows as filled. */
export const HIGH_AFFINITY_SCORE = 70;
/** Both-rated works a media type needs to get its own "by type" line. */
export const MIN_TYPE_BOTH_RATED = 3;

/** One medium's slice of a side's time. */
export interface TasteTimeShare {
  type: string;
  hours: number;
  /** 0-1 of that side's total hours. */
  share: number;
}

export interface TasteSharedGenre {
  /** As the catalog spells it (the key getGenreLabel translates). */
  genre: string;
  /** Share of each side's engagement-weighted genre total, 0-1. */
  own: number;
  their: number;
}

/** What both libraries say beyond the Rust-side counts (librarySignals). */
export interface TasteLibrarySignals {
  /** Mean status agreement over works both have, 0-1; null if none shared. */
  statusSimilarity: number | null;
  /** Works both have with a status, the evidence behind statusSimilarity. */
  statusShared: number;
  /** Cosine similarity of engagement-weighted genre vectors; null without genres. */
  genreSimilarity: number | null;
  /** Hours-per-medium histogram intersection, 0-1; null if a side logged no hours. */
  hoursSimilarity: number | null;
  /** The smaller side's total hours (H's evidence). */
  hoursEvidence: number;
  /** Profile-vector similarity of both whole libraries (P), 0-1. */
  profileSimilarity: number | null;
  /** The smaller side's count of works the other doesn't have (P's evidence). */
  nonSharedEvidence: number;
  /** Time split per side, most hours first (empty when no hours). */
  ownTime: TasteTimeShare[];
  theirTime: TasteTimeShare[];
  /** Genres both engage with most, best first. */
  sharedGenres: TasteSharedGenre[];
}

export type TasteWeightKey = 'rating' | 'overlap' | 'status' | 'genre' | 'hours' | 'profile';
export type TasteComponentKey = TasteWeightKey | 'favorites';

export interface TasteCompatibility {
  /** 0-100, always. */
  score: number;
  /** Component values, 0-1 (null when that evidence doesn't exist). */
  ratingAgreement: number | null;
  overlap: number;
  statusSimilarity: number | null;
  genreSimilarity: number | null;
  hoursSimilarity: number | null;
  profileSimilarity: number | null;
  /** Bonus in points. */
  favoriteBonus: number;
  /** Each component's share of the base score (see tasteComponentBars). */
  weights: Record<TasteWeightKey, number>;
  sharedWorks: number;
  sharedCompleted: number;
  bothRated: number;
  /** Mean |own - their| over every both-rated work, 0-1. */
  meanAbsDiff: number | null;
  sharedFavorites: string[];
  /** Both rated ≥ 0.9, best first, excluding shared favourites. */
  bothLoved: TasteRatingPair[];
  /** Gaps ≥ 0.5 between the two ratings, largest first, at most 5. */
  disagreements: TasteRatingPair[];
  /** Every rating pair (for the per-type split). */
  ratingPairs: TasteRatingPair[];
  ownTime: TasteTimeShare[];
  theirTime: TasteTimeShare[];
  sharedGenres: TasteSharedGenre[];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function ratingAgreement(pairs: TasteRatingPair[]): number | null {
  if (pairs.length === 0) return null;
  let weighted = 0;
  let totalWeight = 0;
  for (const { own, their } of pairs) {
    const diff = Math.abs(clamp01(own) - clamp01(their));
    let weight = 1;
    if (own >= HIGH_RATING && their >= HIGH_RATING) weight = HIGH_AGREEMENT_WEIGHT;
    else if (diff >= STRONG_DISAGREEMENT) weight = STRONG_DISAGREEMENT_WEIGHT;
    weighted += weight * (1 - diff);
    totalWeight += weight;
  }
  return clamp01((weighted / totalWeight - 0.5) / 0.5);
}

export function libraryOverlap(shared: number, ownEngaged: number, theirEngaged: number): number {
  const union = ownEngaged + theirEngaged - shared;
  if (shared <= 0 || union <= 0) return 0;
  return clamp01(Math.log1p(shared) / Math.log1p(union));
}

export function favoriteBonus(sharedFavorites: number): number {
  return Math.min(FAVORITE_BONUS_MAX, Math.max(0, sharedFavorites) * FAVORITE_BONUS_EACH);
}

type StatusBucket = 'completed' | 'in_progress' | 'planning' | 'paused' | 'dropped';

function statusBucket(status: string | null | undefined): StatusBucket | null {
  switch (status) {
    case 'completed': return 'completed';
    case 'watching': case 'reading': case 'playing': case 'in_progress': return 'in_progress';
    case 'planning': return 'planning';
    case 'paused': return 'paused';
    case 'dropped': return 'dropped';
    default: return null;
  }
}

/** How much two statuses on the same work agree, 0-1. Same status agrees;
 *  finishing (or being on) a work the other dropped disagrees; "planning"
 *  says little either way. */
export function statusAgreement(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = statusBucket(a);
  const y = statusBucket(b);
  if (!x || !y) return null;
  if (x === y) return 1;
  const pair = new Set([x, y]);
  const has = (s: StatusBucket) => pair.has(s);
  if (has('completed') && has('in_progress')) return 0.75;
  if (has('dropped') && (has('completed') || has('in_progress'))) return 0;
  if (has('paused') && has('dropped')) return 0.6;
  if (has('paused')) return 0.5;
  return 0.5; // planning vs anything else
}

/** Cosine similarity of two non-negative count vectors, 0-1; null if either is empty. */
export function cosineSimilarity(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number | null {
  let dot = 0, normA = 0, normB = 0;
  for (const [key, value] of a) {
    normA += value * value;
    const other = b.get(key);
    if (other) dot += value * other;
  }
  for (const value of b.values()) normB += value * value;
  if (normA === 0 || normB === 0) return null;
  return clamp01(dot / Math.sqrt(normA * normB));
}

/** Overlap of two distributions (Σ min of each key's share), 0-1; null if
 *  either side sums to 0. 1 when the splits match, 0 when disjoint. */
export function distributionOverlap(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number | null {
  const sum = (m: ReadonlyMap<string, number>) => [...m.values()].reduce((acc, v) => acc + Math.max(0, v), 0);
  const totalA = sum(a);
  const totalB = sum(b);
  if (totalA <= 0 || totalB <= 0) return null;
  let overlap = 0;
  for (const [key, value] of a) {
    const other = b.get(key);
    if (other && other > 0 && value > 0) overlap += Math.min(value / totalA, other / totalB);
  }
  return clamp01(overlap);
}

export interface TasteLibraryEntry {
  external_id: string;
  status: string | null;
  /** DB 0-10 scale; null / 0 is unrated. */
  rating?: number | null;
}

/** The catalog columns the profile vectors read. */
export type TasteCatalogRow = Partial<Pick<CatalogSummary, 'genres_csv' | 'format' | 'release_year'>>;

export interface TasteSide {
  entries: readonly TasteLibraryEntry[];
  /** Hours per media type — hoursByMedium, the Stats tab's numbers. */
  hours?: ReadonlyMap<string, number>;
}

function typeOf(externalId: string): string | null {
  const colon = externalId.indexOf(':');
  return colon > 0 ? externalId.slice(0, colon) : null;
}

/** Hours per media type exactly as the profile Stats tab's "time by
 *  category" computes them (computeTypeBreakdown); types with 0 h left out. */
export function hoursByMedium(items: LibraryEntry[], catalogMap: Map<string, CatalogSummary>): Map<string, number> {
  const hours = new Map<string, number>();
  for (const { type, hours: h } of computeTypeBreakdown(items, catalogMap)) {
    if (h > 0) hours.set(type, h);
  }
  return hours;
}

const STATUS_ENGAGEMENT: Record<StatusBucket, number> = {
  completed: 1, in_progress: 0.7, paused: 0.5, planning: 0.25, dropped: 0.15,
};
const UNKNOWN_STATUS_ENGAGEMENT = 0.3;
const UNRATED_FACTOR = 0.8;

/** How much a work says about its owner's taste: status × rating factor. */
export function engagementWeight(entry: TasteLibraryEntry): number {
  const bucket = statusBucket(entry.status);
  const statusWeight = bucket ? STATUS_ENGAGEMENT[bucket] : UNKNOWN_STATUS_ENGAGEMENT;
  const rating = entry.rating ?? 0;
  const r = clamp01(rating / 10);
  const ratingFactor = rating > 0 ? 0.2 + 1.3 * r * r : UNRATED_FACTOR;
  return statusWeight * ratingFactor;
}

function addTo(map: Map<string, number>, key: string, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

interface SideVectors {
  genres: Map<string, number>;
  /** Lower-case genre → the catalog's own spelling (first seen). */
  genreNames: Map<string, string>;
  types: Map<string, number>;
  formats: Map<string, number>;
  decades: Map<string, number>;
}

function sideVectors(entries: readonly TasteLibraryEntry[], catalogOf: (externalId: string) => TasteCatalogRow | undefined): SideVectors {
  const v: SideVectors = { genres: new Map(), genreNames: new Map(), types: new Map(), formats: new Map(), decades: new Map() };
  for (const entry of entries) {
    const type = typeOf(entry.external_id);
    if (type) addTo(v.types, type, 1);
    const row = catalogOf(entry.external_id);
    if (!row) continue;
    if (row.format) addTo(v.formats, row.format, 1);
    if (row.release_year && row.release_year > 1800) addTo(v.decades, String(Math.floor(row.release_year / 10) * 10), 1);
    if (!row.genres_csv) continue;
    const weight = engagementWeight(entry);
    for (const raw of row.genres_csv.split(',')) {
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!v.genreNames.has(key)) v.genreNames.set(key, name);
      addTo(v.genres, key, weight);
    }
  }
  return v;
}

function sharedGenres(own: SideVectors, their: SideVectors): TasteSharedGenre[] {
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const ownTotal = total(own.genres);
  const theirTotal = total(their.genres);
  if (ownTotal <= 0 || theirTotal <= 0) return [];
  const result: TasteSharedGenre[] = [];
  for (const [key, ownWeight] of own.genres) {
    const theirWeight = their.genres.get(key);
    if (!theirWeight) continue;
    const ownShare = ownWeight / ownTotal;
    const theirShare = theirWeight / theirTotal;
    if (Math.min(ownShare, theirShare) < SHARED_GENRE_MIN_SHARE) continue;
    result.push({ genre: own.genreNames.get(key) ?? key, own: ownShare, their: theirShare });
  }
  return result
    .sort((a, b) => Math.min(b.own, b.their) - Math.min(a.own, a.their) || a.genre.localeCompare(b.genre))
    .slice(0, MAX_SHARED_GENRES);
}

function timeShares(hours: ReadonlyMap<string, number> | undefined): TasteTimeShare[] {
  if (!hours) return [];
  const total = [...hours.values()].reduce((acc, h) => acc + Math.max(0, h), 0);
  if (total <= 0) return [];
  return [...hours.entries()]
    .filter(([, h]) => h > 0)
    .map(([type, h]) => ({ type, hours: h, share: h / total }))
    .sort((a, b) => b.hours - a.hours || a.type.localeCompare(b.type));
}

function meanRating(entries: readonly TasteLibraryEntry[]): { mean: number; n: number } {
  let sum = 0, n = 0;
  for (const e of entries) {
    if (e.rating && e.rating > 0) { sum += clamp01(e.rating / 10); n++; }
  }
  return { mean: n > 0 ? sum / n : 0, n };
}

/** Profile-vector similarity (P): mean cosine over types / formats /
 *  decades, blended with the non-shared works' rating level. */
function profileSimilarity(
  own: SideVectors, their: SideVectors,
  ownOnly: readonly TasteLibraryEntry[], theirOnly: readonly TasteLibraryEntry[],
): number | null {
  const parts = [
    cosineSimilarity(own.types, their.types),
    cosineSimilarity(own.formats, their.formats),
    cosineSimilarity(own.decades, their.decades),
  ].filter((x): x is number => x !== null);
  if (parts.length === 0) return null;
  const vector = parts.reduce((a, b) => a + b, 0) / parts.length;
  const ownLevel = meanRating(ownOnly);
  const theirLevel = meanRating(theirOnly);
  if (ownLevel.n < PROFILE_MIN_RATED || theirLevel.n < PROFILE_MIN_RATED) return vector;
  const level = 1 - Math.min(1, Math.abs(ownLevel.mean - theirLevel.mean) / PROFILE_RATING_GAP);
  return (1 - PROFILE_RATING_SHARE) * vector + PROFILE_RATING_SHARE * level;
}

/** Status, genre, hours and profile signals from both whole libraries.
 *  `catalogOf` resolves a work's catalog row (genres, format, release year). */
export function librarySignals(
  own: TasteSide,
  their: TasteSide,
  catalogOf: (externalId: string) => TasteCatalogRow | undefined,
): TasteLibrarySignals {
  const theirStatus = new Map(their.entries.map(item => [item.external_id, item.status]));
  const ownIds = new Set(own.entries.map(item => item.external_id));
  let agreementSum = 0;
  let statusShared = 0;
  for (const item of own.entries) {
    if (!theirStatus.has(item.external_id)) continue;
    const agreement = statusAgreement(item.status, theirStatus.get(item.external_id));
    if (agreement === null) continue;
    agreementSum += agreement;
    statusShared++;
  }
  const ownVectors = sideVectors(own.entries, catalogOf);
  const theirVectors = sideVectors(their.entries, catalogOf);
  const ownOnly = own.entries.filter(item => !theirStatus.has(item.external_id));
  const theirOnly = their.entries.filter(item => !ownIds.has(item.external_id));
  const ownTime = timeShares(own.hours);
  const theirTime = timeShares(their.hours);
  const totalHours = (t: TasteTimeShare[]) => t.reduce((acc, x) => acc + x.hours, 0);
  const hoursMap = (t: TasteTimeShare[]) => new Map(t.map(x => [x.type, x.hours]));
  return {
    statusSimilarity: statusShared > 0 ? agreementSum / statusShared : null,
    statusShared,
    genreSimilarity: cosineSimilarity(ownVectors.genres, theirVectors.genres),
    hoursSimilarity: distributionOverlap(hoursMap(ownTime), hoursMap(theirTime)),
    hoursEvidence: Math.min(totalHours(ownTime), totalHours(theirTime)),
    profileSimilarity: profileSimilarity(ownVectors, theirVectors, ownOnly, theirOnly),
    nonSharedEvidence: Math.min(ownOnly.length, theirOnly.length),
    ownTime,
    theirTime,
    sharedGenres: sharedGenres(ownVectors, theirVectors),
  };
}

export function computeTasteCompatibility(data: TasteCompatibilityData, signals?: TasteLibrarySignals): TasteCompatibility {
  const agreement = ratingAgreement(data.rating_pairs);
  const overlap = libraryOverlap(data.shared_engaged, data.own_engaged, data.their_engaged);
  const status = signals?.statusSimilarity ?? null;
  const genre = signals?.genreSimilarity ?? null;
  const hours = signals?.hoursSimilarity ?? null;
  const profile = signals?.profileSimilarity ?? null;
  const bonus = favoriteBonus(data.shared_favorites_total);

  // Evidence-adaptive weights (see the header).
  const c = agreement === null ? 0 : data.both_rated / (data.both_rated + RATING_CONFIDENCE_K);
  const statusShared = status === null ? 0 : signals?.statusShared ?? 0;
  const statusConfidence = statusShared / (statusShared + STATUS_CONFIDENCE_K);
  const hoursEvidence = hours === null ? 0 : signals?.hoursEvidence ?? 0;
  const hoursConfidence = hoursEvidence / (hoursEvidence + HOURS_CONFIDENCE_K);
  const nonShared = profile === null ? 0 : signals?.nonSharedEvidence ?? 0;
  const profileShare = PROFILE_SHARE_MAX * nonShared / (nonShared + PROFILE_CONFIDENCE_K);
  const raw = {
    rating: agreement === null ? 0 : RATING_WEIGHT * c,
    overlap: OVERLAP_WEIGHT * (1 - 0.6 * c),
    status: STATUS_WEIGHT * statusConfidence * (1 - 0.7 * c),
    genre: genre === null ? 0 : GENRE_WEIGHT * (1 - 0.5 * c),
    hours: HOURS_WEIGHT * hoursConfidence * (1 - 0.7 * c),
  };
  const total = raw.rating + raw.overlap + raw.status + raw.genre + raw.hours;
  const scale = (1 - profileShare) / total;
  const weights: Record<TasteWeightKey, number> = {
    rating: raw.rating * scale,
    overlap: raw.overlap * scale,
    status: raw.status * scale,
    genre: raw.genre * scale,
    hours: raw.hours * scale,
    profile: profileShare,
  };
  const base = weights.rating * (agreement ?? 0) + weights.overlap * overlap
    + weights.status * (status ?? 0) + weights.genre * (genre ?? 0)
    + weights.hours * (hours ?? 0) + weights.profile * (profile ?? 0);
  const score = Math.round(Math.max(0, Math.min(100, 100 * base + bonus)));

  const favorites = new Set(data.shared_favorites);
  const bothLoved = data.rating_pairs
    .filter(p => p.own >= LOVED_RATING && p.their >= LOVED_RATING && !favorites.has(p.external_id))
    .sort((a, b) => (b.own + b.their) - (a.own + a.their))
    .slice(0, MAX_BOTH_LOVED);

  const disagreements = data.rating_pairs
    .filter(p => Math.abs(p.own - p.their) >= STRONG_DISAGREEMENT)
    .sort((a, b) => Math.abs(b.own - b.their) - Math.abs(a.own - a.their))
    .slice(0, MAX_DISAGREEMENTS);

  return {
    score,
    ratingAgreement: agreement,
    overlap,
    statusSimilarity: status,
    genreSimilarity: genre,
    hoursSimilarity: hours,
    profileSimilarity: profile,
    favoriteBonus: bonus,
    weights,
    sharedWorks: data.shared_works,
    sharedCompleted: data.shared_completed,
    bothRated: data.both_rated,
    meanAbsDiff: data.mean_abs_diff,
    sharedFavorites: data.shared_favorites,
    bothLoved,
    disagreements,
    ratingPairs: data.rating_pairs,
    ownTime: signals?.ownTime ?? [],
    theirTime: signals?.theirTime ?? [],
    sharedGenres: signals?.sharedGenres ?? [],
  };
}

export function isHighAffinity(taste: TasteCompatibility | null | undefined): boolean {
  return taste != null && taste.score >= HIGH_AFFINITY_SCORE;
}

/** Playful verdict band for the score (the modal's headline). */
export type TasteVerdict = 'soulmates' | 'very' | 'complementary' | 'different' | 'opposites';

export function tasteVerdict(score: number): TasteVerdict {
  if (score >= 85) return 'soulmates';
  if (score >= 70) return 'very';
  if (score >= 50) return 'complementary';
  if (score >= 30) return 'different';
  return 'opposites';
}

export interface TasteComponentBar {
  key: TasteComponentKey;
  /** 0-1 fill of the bar (the component against its own maximum). */
  fraction: number;
  /** Points it adds to the score, and the most it could add. */
  points: number;
  maxPoints: number;
}

/** The score's terms as bars, in "How it adds up" order. A component with
 *  no evidence behind it has weight 0 (an empty bar out of 0). */
export function tasteComponentBars(taste: TasteCompatibility): TasteComponentBar[] {
  const bar = (key: TasteWeightKey, value: number | null): TasteComponentBar => {
    const max = 100 * taste.weights[key];
    const x = clamp01(value ?? 0);
    return { key, fraction: x, points: Math.round(max * x), maxPoints: Math.round(max) };
  };
  return [
    bar('rating', taste.ratingAgreement),
    bar('genre', taste.genreSimilarity),
    bar('hours', taste.hoursSimilarity),
    bar('status', taste.statusSimilarity),
    bar('overlap', taste.overlap),
    bar('profile', taste.profileSimilarity),
    { key: 'favorites', fraction: clamp01(taste.favoriteBonus / FAVORITE_BONUS_MAX), points: taste.favoriteBonus, maxPoints: FAVORITE_BONUS_MAX },
  ];
}

export interface TasteTypeSplit {
  /** Media type, the external_id prefix ("anime", "game"…). */
  type: string;
  bothRated: number;
  /** Rating agreement for that type as 0-100. */
  agreement: number;
}

/** Rating agreement per media type, from the pairs already fetched: types
 *  with fewer than MIN_TYPE_BOTH_RATED pairs are left out, most-rated first. */
export function tasteByType(pairs: TasteRatingPair[]): TasteTypeSplit[] {
  const byType = new Map<string, TasteRatingPair[]>();
  for (const pair of pairs) {
    const type = typeOf(pair.external_id);
    if (!type) continue;
    const list = byType.get(type) ?? [];
    list.push(pair);
    byType.set(type, list);
  }
  const result: TasteTypeSplit[] = [];
  for (const [type, list] of byType) {
    if (list.length < MIN_TYPE_BOTH_RATED) continue;
    result.push({ type, bothRated: list.length, agreement: Math.round(100 * (ratingAgreement(list) ?? 0)) });
  }
  return result.sort((a, b) => b.bothRated - a.bothRated || a.type.localeCompare(b.type));
}
