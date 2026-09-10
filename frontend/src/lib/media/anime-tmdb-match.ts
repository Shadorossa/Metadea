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
  totalCount: number;
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
  return {
    externalId: e.external_id,
    title: e.title_romaji || e.title_main || e.title_english || '',
    totalCount: e.total_count ?? 0,
    releaseYear: e.release_year ?? undefined,
  };
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
    if (!entry || entry.type !== 'anime') break;
    backward.unshift(toChainEntry(entry));
    visited.add(entry.external_id);
    cursor = entry.external_id;
  }

  const forward: AnimeChainEntry[] = [toChainEntry(self)];
  cursor = rawId;
  for (let i = 0; i < MAX_CHAIN_LENGTH; i++) {
    const relations = await getMediaRelations(cursor).catch(() => []);
    const sequel = relations.find(r => r.relation_type === 'SEQUEL');
    if (!sequel || visited.has(sequel.related_media_external_id)) break;
    const entry = await getCatalogEntry(sequel.related_media_external_id).catch(() => null);
    if (!entry || entry.type !== 'anime') break;
    forward.push(toChainEntry(entry));
    visited.add(entry.external_id);
    cursor = entry.external_id;
  }

  return [...backward, ...forward];
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
const chainMatchCache = new Map<string, Promise<{ tmdbId: number; mapping: Map<string, TmdbEpisodeSlice[]> } | null>>();

async function resolveChainMatch(chain: AnimeChainEntry[]): Promise<{ tmdbId: number; mapping: Map<string, TmdbEpisodeSlice[]> } | null> {
  const headId = chain[0].externalId;
  let cached = chainMatchCache.get(headId);
  if (!cached) {
    cached = computeChainMatch(chain);
    chainMatchCache.set(headId, cached);
  }
  return cached;
}

async function computeChainMatch(chain: AnimeChainEntry[]): Promise<{ tmdbId: number; mapping: Map<string, TmdbEpisodeSlice[]> } | null> {
  const searchTitle = chain[0].title;
  if (!searchTitle) return null;

  const controller = new AbortController();
  const hits = await searchTvIncludingAnime(searchTitle, controller.signal).catch(() => []);
  if (!hits.length) return null;

  // TMDB's own relevance ranking rarely needs more than a handful of
  // candidates checked before the per-entry episode-count matching below
  // picks the right one out.
  const candidates = hits.slice(0, 5);
  const chainStartYear = chain[0].releaseYear;

  let best: { tmdbId: number; mapping: Map<string, TmdbEpisodeSlice[]>; matchedCount: number } | null = null;

  for (const candidate of candidates) {
    const id = candidate.id;
    if (!id) continue;
    const detail = await fetchTmdbDetail(id, 'series').catch(() => null) as TmdbTvDetail | null;
    if (!detail?.seasons?.length) continue;

    // A loose year check just to skip obviously-wrong candidates (a
    // same-named unrelated show, a remaster/remake) — the real validation
    // is the per-entry episode-count matching below, not this.
    if (chainStartYear && detail.first_air_date) {
      const tmdbYear = parseInt(detail.first_air_date.slice(0, 4), 10);
      if (Number.isFinite(tmdbYear) && Math.abs(tmdbYear - chainStartYear) > 1) continue;
    }

    const realSeasons: TmdbSeasonCount[] = detail.seasons
      .filter((s): s is TmdbSeasonSummary & { episode_count: number } => s.season_number > 0 && !!s.episode_count)
      .map(s => ({ season_number: s.season_number, episode_count: s.episode_count }))
      .sort((a, b) => a.season_number - b.season_number);
    if (realSeasons.length === 0) continue;

    const { mapping, matchedCount } = matchChainAgainstSeasons(chain, realSeasons);
    if (matchedCount === 0) continue;

    // Prefer whichever candidate explains more of the chain.
    if (!best || matchedCount > best.matchedCount) {
      best = { tmdbId: id, mapping, matchedCount };
    }
  }

  return best ? { tmdbId: best.tmdbId, mapping: best.mapping } : null;
}

export async function matchTmdbSeasonsForAnime(rawId: string): Promise<TmdbSeasonMatch | null> {
  const { type } = parseExternalId(rawId);
  if (type !== 'anime') return null;

  const chain = await buildAnimeChain(rawId);
  if (chain.length === 0) return null;

  const chainMatch = await resolveChainMatch(chain);
  if (!chainMatch) return null;

  const slices = chainMatch.mapping.get(rawId);
  if (!slices?.length) return null;

  return { tmdbId: chainMatch.tmdbId, slices };
}
