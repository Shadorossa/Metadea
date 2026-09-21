// Maps an anime's AniList prequel/sequel chain onto TMDB's own season split,
// so episode-list.ts can pull TMDB's richer per-episode data (thumbnails,
// titles) for anime too, not just for `series`. The two providers disagree
// on where one "show" ends and the next begins — TMDB keeps a long-running
// anime (Gintama) as ONE series with many seasons, while AniList files each
// season as its own separate entry; the inverse also happens (The Big O's
// two AniList entries, 13 episodes each, are ONE TMDB season with all 26).
// Matching by title/year alone isn't reliable enough (sequels reuse names,
// several unrelated shows share one), so this leans on episode counts, which
// are exact and already sitting in the local catalog for the whole chain —
// no AniList calls needed, only DB reads plus one TMDB search+detail fetch.
//
// The core idea: flatten every candidate's seasons into one continuous
// numbered episode stream (season 1 ep 1, season 1 ep 2, ..., season 2 ep 1,
// ...) and carve consecutive chunks out of it, one chunk per chain entry,
// sized to that entry's own total_count. This treats "TMDB seasons" as an
// implementation detail — a chunk can span several whole seasons (Gintama)
// or be a slice of just part of one (The Big O) — instead of assuming
// AniList's and TMDB's season boundaries ever have to agree.
//
// Entirely best-effort: any chain entry the stream doesn't have enough
// episodes left to fill gets no mapping, and the caller falls back to
// AniList's own episode data for that one entry — entries matched earlier
// in the chain keep their mapping regardless.
import { searchTvIncludingAnime, fetchTmdbDetail, type TmdbTvDetail, type TmdbSeasonSummary } from '../search/providers/tmdb';
import { getCatalogEntry, getMediaRelations, type MediaCatalogEntry } from '../tauri/catalog';
import { parseExternalId } from './mapper-utils';

export interface AnimeChainEntry {
  externalId: string;
  title: string;
  titles: string[];
  totalCount: number;
  format?: string;
  releaseYear?: number;
}

export interface TmdbEpisodeSlice {
  season_number: number;
  /** 1-based, inclusive, in that season's own TMDB episode_number space. */
  episodeStart: number;
  episodeEnd: number;
}

export interface TmdbSeasonMatch {
  tmdbId: number;
  originalLanguage?: string;
  /** One or more (season, episode-range) slices, in airing order, whose
   *  concatenation is this one AniList entry's full episode list. Usually a
   *  single slice covering a whole season; several slices when a chain
   *  entry spans multiple TMDB seasons or only part of one. */
  slices: TmdbEpisodeSlice[];
}

// Safety cap against a corrupt/cyclic relations graph — no real anime saga
// runs anywhere near this many entries.
const MAX_CHAIN_LENGTH = 25;

function toChainEntry(e: MediaCatalogEntry): AnimeChainEntry {
  const titles = [e.title_romaji, e.title_main, e.title_english, e.title_native]
    .filter((title): title is string => !!title?.trim())
    .filter((title, index, all) => all.findIndex(candidate => candidate.toLowerCase() === title.toLowerCase()) === index);
  return {
    externalId: e.external_id,
    title: titles[0] ?? '',
    titles,
    totalCount: e.total_count ?? 0,
    format: e.format ?? undefined,
    releaseYear: e.release_year ?? undefined,
  };
}

function contributesToTvEpisodeStream(entry: AnimeChainEntry): boolean {
  const format = entry.format?.toUpperCase();
  return format !== 'MOVIE' && !(format === 'SPECIAL' && entry.totalCount <= 1);
}

// Walks PREQUEL/SEQUEL relations both ways from rawId, entirely off the
// local catalog (getMediaRelations/getCatalogEntry are DB reads, no network)
// — every entry in the chain is already curated locally, same data
// addSequelToPlanning (tauri/library.ts) reads for the same relation edges.
// Stops at the first non-anime entry (a manga SOURCE relation, say) or a
// repeat id, so it never wanders off the actual season chain.
export async function buildAnimeChain(rawId: string): Promise<AnimeChainEntry[]> {
  const self = await getCatalogEntry(rawId).catch(() => null);
  if (!self || self.type !== 'anime') return [];

  const visited = new Set<string>([rawId]);

  const backward: AnimeChainEntry[] = [];
  let cursor = rawId;
  for (let i = 0; i < MAX_CHAIN_LENGTH; i++) {
    const relations = await getMediaRelations(cursor).catch(() => []);
    const prequel = relations.find(r => r.relation_type === 'PREQUEL');
    if (!prequel || visited.has(prequel.related_media_external_id)) break;
    const entry = await getCatalogEntry(prequel.related_media_external_id).catch(() => null);
    if (entry && entry.type !== 'anime') break;
    if (!entry && !prequel.related_media_external_id.startsWith('anime:')) break;
    backward.unshift(entry ? toChainEntry(entry) : {
      externalId: prequel.related_media_external_id,
      title: '',
      titles: [],
      totalCount: 0,
    });
    visited.add(prequel.related_media_external_id);
    cursor = prequel.related_media_external_id;
  }

  const forward: AnimeChainEntry[] = [toChainEntry(self)];
  cursor = rawId;
  for (let i = 0; i < MAX_CHAIN_LENGTH; i++) {
    const relations = await getMediaRelations(cursor).catch(() => []);
    const sequel = relations.find(r => r.relation_type === 'SEQUEL');
    if (!sequel || visited.has(sequel.related_media_external_id)) break;
    const entry = await getCatalogEntry(sequel.related_media_external_id).catch(() => null);
    if (entry && entry.type !== 'anime') break;
    if (!entry && !sequel.related_media_external_id.startsWith('anime:')) break;
    forward.push(entry ? toChainEntry(entry) : {
      externalId: sequel.related_media_external_id,
      title: '',
      titles: [],
      totalCount: 0,
    });
    visited.add(sequel.related_media_external_id);
    cursor = sequel.related_media_external_id;
  }

  return [...backward, ...forward];
}

export async function getAnimePrequelEpisodeOffset(rawId: string): Promise<number> {
  const chain = await buildAnimeChain(rawId);
  const selfIdx = chain.findIndex(e => e.externalId === rawId);
  if (selfIdx <= 0) return 0;
  return chain.slice(0, selfIdx).reduce(
    (sum, entry) => sum + (contributesToTvEpisodeStream(entry) ? entry.totalCount || 0 : 0),
    0,
  );
}

interface TmdbSeasonCount {
  season_number: number;
  episode_count: number;
}

// Slices `seasons`' flattened episode stream to the half-open range
// [flatStart, flatEnd) (0-based flat episode index across every season
// concatenated in order) and expresses the result back in per-season,
// 1-based episode-number terms.
function flatRangeToSlices(seasons: TmdbSeasonCount[], flatStart: number, flatEnd: number): TmdbEpisodeSlice[] {
  const slices: TmdbEpisodeSlice[] = [];
  let cursor = 0;
  for (const s of seasons) {
    const seasonStart = cursor;
    const seasonEnd = cursor + s.episode_count;
    cursor = seasonEnd;
    if (seasonEnd <= flatStart) continue;
    if (seasonStart >= flatEnd) break;
    slices.push({
      season_number: s.season_number,
      episodeStart: Math.max(flatStart, seasonStart) - seasonStart + 1,
      episodeEnd:   Math.min(flatEnd, seasonEnd) - seasonStart,
    });
  }
  return slices;
}

interface ChainMatchResult {
  mapping: Map<string, TmdbEpisodeSlice[]>;
  matchedCount: number;
}

// Carves the chain's own entry-by-entry episode counts out of TMDB's
// flattened season stream, in order — entry N's chunk starts exactly where
// entry N-1's left off. Stops (doesn't abort) the moment the stream runs
// short of what the next entry needs, since that means this TMDB candidate
// genuinely doesn't cover it (an unreleased season, a movie AniList counts
// as its own entry but TMDB doesn't track as a season, ...); every entry
// matched before that point keeps its mapping.
function matchChainAgainstSeasons(chain: AnimeChainEntry[], seasons: TmdbSeasonCount[]): ChainMatchResult {
  const totalAvailable = seasons.reduce((sum, s) => sum + s.episode_count, 0);
  const mapping = new Map<string, TmdbEpisodeSlice[]>();
  let consumed = 0;
  let matchedCount = 0;

  for (const entry of chain) {
    // Movies and one-off specials exist in AniList's PREQUEL/SEQUEL graph,
    // but not in TMDB's numbered TV seasons. They are inserted separately
    // by MediaPage when the unified episode view is enabled.
    if (!contributesToTvEpisodeStream(entry)) continue;
    if (!entry.totalCount) break;
    const end = consumed + entry.totalCount;
    if (end > totalAvailable) break;

    const slices = flatRangeToSlices(seasons, consumed, end);
    if (slices.length === 0) break;

    mapping.set(entry.externalId, slices);
    consumed = end;
    matchedCount++;
  }

  return { mapping, matchedCount };
}

// Cached per chain-head external id (not per rawId) — every entry in the
// same saga shares one search+candidate-picking pass, so visiting several
// pages of the same anime within a session only does this once.
const chainMatchCache = new Map<string, { signature: string; result: Promise<{ tmdbId: number; originalLanguage?: string; mapping: Map<string, TmdbEpisodeSlice[]> } | null> }>();

async function resolveChainMatch(chain: AnimeChainEntry[], forcedTmdbId?: number): Promise<{ tmdbId: number; originalLanguage?: string; mapping: Map<string, TmdbEpisodeSlice[]> } | null> {
  const headId = chain[0].externalId;
  const signature = `${forcedTmdbId ?? 'auto'}:${chain.map(entry => `${entry.externalId}:${entry.totalCount}:${entry.releaseYear ?? ''}:${entry.titles.join(',')}`).join('|')}`;
  let cached = chainMatchCache.get(headId);
  if (!cached || cached.signature !== signature) {
    cached = { signature, result: computeChainMatch(chain, forcedTmdbId) };
    chainMatchCache.set(headId, cached);
  }
  return cached.result;
}

async function computeChainMatch(chain: AnimeChainEntry[], forcedTmdbId?: number): Promise<{ tmdbId: number; originalLanguage?: string; mapping: Map<string, TmdbEpisodeSlice[]> } | null> {
  // A sequel chain can begin with a movie or one-off special which TMDB
  // doesn't include in the TV episode stream. Search using its first actual
  // TV entry, while still matching the candidate against the whole chain.
  const firstTvEntry = chain.find(entry => contributesToTvEpisodeStream(entry) && entry.totalCount > 0);
  if (!firstTvEntry) return null;

  const candidates = forcedTmdbId
    ? [{ id: forcedTmdbId }]
    : await searchEntryCandidates(firstTvEntry);
  if (!candidates.length) return null;
  const chainStartYear = firstTvEntry.releaseYear;

  const evaluated = await Promise.all(candidates.map(async candidate => {
    const detail = await fetchTmdbDetail(candidate.id, 'series').catch(() => null) as TmdbTvDetail | null;
    if (!detail?.seasons?.length) return null;

    // A loose year check just to skip obviously-wrong candidates (a
    // same-named unrelated show, a remaster/remake) — the real validation
    // is the per-entry episode-count matching below, not this.
    if (chainStartYear && detail.first_air_date) {
      const tmdbYear = parseInt(detail.first_air_date.slice(0, 4), 10);
      if (Number.isFinite(tmdbYear) && Math.abs(tmdbYear - chainStartYear) > 2) return null;
    }

    const realSeasons: TmdbSeasonCount[] = detail.seasons
      .filter((s): s is TmdbSeasonSummary & { episode_count: number } => s.season_number > 0 && !!s.episode_count)
      .map(s => ({ season_number: s.season_number, episode_count: s.episode_count }))
      .sort((a, b) => a.season_number - b.season_number);
    if (realSeasons.length === 0) return null;

    const { mapping, matchedCount } = matchChainAgainstSeasons(chain, realSeasons);
    if (matchedCount === 0) return null;
    const availableCount = realSeasons.reduce((sum, season) => sum + season.episode_count, 0);
    const expectedCount = chain.reduce((sum, entry) => sum + (contributesToTvEpisodeStream(entry) ? entry.totalCount : 0), 0);
    return {
      tmdbId: candidate.id,
      originalLanguage: detail.original_language,
      mapping,
      matchedCount,
      yearDelta: chainStartYear && detail.first_air_date ? Math.abs(Number(detail.first_air_date.slice(0, 4)) - chainStartYear) : 99,
      countDelta: Math.abs(availableCount - expectedCount),
    };
  }));

  const best = evaluated.filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
    .sort((a, b) => b.matchedCount - a.matchedCount || a.yearDelta - b.yearDelta || a.countDelta - b.countDelta)[0];
  // Keep every validated leading slice even when a later entry lives in a
  // separate TMDB show. Requiring one candidate to cover the entire saga
  // would discard the correct long-running stream and make all entries fall
  // back to ambiguous standalone title searches.
  return best ? { tmdbId: best.tmdbId, originalLanguage: best.originalLanguage, mapping: best.mapping } : null;
}

const standaloneMatchCache = new Map<string, { signature: string; result: Promise<TmdbSeasonMatch | null> }>();

async function searchEntryCandidates(entry: AnimeChainEntry) {
  const controller = new AbortController();
  const aliases = entry.titles.length ? entry.titles : [entry.title];
  const searches = await Promise.all(aliases.slice(0, 4).filter(Boolean).map(title =>
    searchTvIncludingAnime(title, controller.signal).catch(() => [])
  ));
  return [...new Map(searches.flat().filter(hit => !!hit.id).map(hit => [hit.id, hit])).values()].slice(0, 12);
}

async function matchStandaloneEntry(entry: AnimeChainEntry): Promise<TmdbSeasonMatch | null> {
  const signature = `${entry.totalCount}:${entry.releaseYear ?? ''}:${entry.titles.join(',')}`;
  let cached = standaloneMatchCache.get(entry.externalId);
  if (!cached || cached.signature !== signature) {
    cached = { signature, result: computeStandaloneMatch(entry) };
    standaloneMatchCache.set(entry.externalId, cached);
  }
  return cached.result;
}

async function computeStandaloneMatch(entry: AnimeChainEntry): Promise<TmdbSeasonMatch | null> {
  // In a franchise chain, a bare title such as "Gintama" is not sufficient
  // evidence for a separate TMDB show: search will commonly return the 2006
  // parent series. A release year is required to distinguish that result
  // from a genuinely independent sequel listing.
  if (!entry.totalCount || !entry.releaseYear) return null;
  const candidates = await searchEntryCandidates(entry);
  if (!candidates.length) return null;
  const evaluated = await Promise.all(candidates.map(async candidate => {
    const detail = await fetchTmdbDetail(candidate.id, 'series').catch(() => null) as TmdbTvDetail | null;
    if (!detail?.seasons?.length) return null;
    const year = Number(detail.first_air_date?.slice(0, 4));
    const yearDelta = Number.isFinite(year) ? Math.abs(year - entry.releaseYear!) : 99;
    // Title hits can include a predecessor's long-running show. Release year
    // and episode count distinguish a separate sequel record automatically.
    if (!Number.isFinite(year) || yearDelta > 2) return null;
    const matchedTitle = [candidate.name, detail.name, detail.original_name]
      .filter((title): title is string => !!title?.trim())
      .some(title => entry.titles.some(alias => normalizeTitle(title) === normalizeTitle(alias)));
    if (!matchedTitle) return null;
    const seasons = detail.seasons
      .filter((season): season is TmdbSeasonSummary & { episode_count: number } => season.season_number > 0 && !!season.episode_count)
      .map(season => ({ season_number: season.season_number, episode_count: season.episode_count }))
      .sort((a, b) => a.season_number - b.season_number);
    const availableCount = seasons.reduce((sum, season) => sum + season.episode_count, 0);
    if (availableCount < entry.totalCount) return null;
    const slices = flatRangeToSlices(seasons, 0, entry.totalCount);
    if (!slices.length) return null;
    return {
      match: { tmdbId: candidate.id, originalLanguage: detail.original_language, slices } satisfies TmdbSeasonMatch,
      yearDelta,
      countDelta: availableCount - entry.totalCount,
    };
  }));
  return evaluated.filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
    .sort((a, b) => a.yearDelta - b.yearDelta || a.countDelta - b.countDelta)[0]?.match ?? null;
}

function normalizeTitle(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export async function matchTmdbSeasonsForAnime(rawId: string, forcedTmdbId?: number): Promise<TmdbSeasonMatch | null> {
  const { type } = parseExternalId(rawId);
  if (type !== 'anime') return null;

  const chain = await buildAnimeChain(rawId);
  if (chain.length > 0) {
    const chainMatch = await resolveChainMatch(chain, forcedTmdbId);
    const ownEntry = chain.find(entry => entry.externalId === rawId);
    // Some sequels are separate TMDB shows even when an episode-count split
    // could place them plausibly inside the predecessor's long-running show.
    // Prefer a title/year/count-validated distinct record over that positional
    // slice (e.g. a short sequel with its own TV listing).
    if (!forcedTmdbId && ownEntry && chainMatch?.mapping.has(rawId)) {
      const standaloneMatch = await matchStandaloneEntry(ownEntry);
      if (standaloneMatch && standaloneMatch.tmdbId !== chainMatch.tmdbId) return standaloneMatch;
    }
    if (chainMatch) {
      const slices = chainMatch.mapping.get(rawId);
      if (slices?.length) {
        return { tmdbId: chainMatch.tmdbId, originalLanguage: chainMatch.originalLanguage, slices };
      }
    }

    // An explicit curator mapping must never silently fall back to another
    // fuzzy TMDB match if its selected show cannot cover this chain entry.
    if (forcedTmdbId) return null;

    if (ownEntry) {
      const standaloneMatch = await matchStandaloneEntry(ownEntry);
      if (standaloneMatch) return standaloneMatch;
    }
    // Never assign a predecessor's episode stream to a sequel just because
    // a standalone match could not be established.
    if (chain.length > 1) return null;
  }

  // Fallback: standalone search on TMDB by the entry's own titles if not covered by the main saga
  const self = await getCatalogEntry(rawId).catch(() => null);
  if (!self) return null;

  if (forcedTmdbId) {
    const manualChainMatch = await resolveChainMatch([toChainEntry(self)], forcedTmdbId);
    const slices = manualChainMatch?.mapping.get(rawId);
    return slices?.length && manualChainMatch
      ? { tmdbId: manualChainMatch.tmdbId, originalLanguage: manualChainMatch.originalLanguage, slices }
      : null;
  }

  return matchStandaloneEntry(toChainEntry(self));
}
