// Per-episode data ("Episodios" tab on the media page), split out of
// mediaService.ts the same way comic-issues.ts/book-editions.ts are —
// sourced from TMDB (series) or AniList's streamingEpisodes (anime), the
// only two providers this app uses that expose anything episode-level at all.
import { fetchTmdbDetail, fetchTmdbEpisodes, fetchTmdbEpisodesForSeasons, type TmdbTvDetail, type TmdbEpisodeSummary } from '../../search/providers/tmdb';
import { fetchAniListStreamingEpisodes } from '../../search/providers/anilist';
import { getLangCode } from '../../../i18n/runtime';
import { firstCsvUrl, parseExternalId } from '../mappers/mapper-utils';
import { buildAnimeChain, matchTmdbSeasonsForAnime, getAnimePrequelEpisodeOffset } from './anime-tmdb-match';
import { saveMediaEpisodes, type MediaEpisode } from '../../tauri';
// Visit-scoped memo (plain reads outside a media page visit): the page's own
// catalog row and cached episode list come out of its mount bundle.
import { readCatalogEntryCached as getCatalogEntry, readMediaEpisodesCached as getMediaEpisodes } from '../media-page-read-cache';

// AniList's streamingEpisodes titles read like "Episode 12 - The Title"
// (sometimes just "Episode 12", occasionally missing the "Episode" word
// entirely for a one-shot/movie) — there's no separate numeric field.
const EPISODE_TITLE_RE = /Episode\s+(\d+(?:\.\d+)?)\s*(?:[-–—]\s*(.+))?/i;
const ANIME_EPISODE_MAPPING_VERSION = 'anime-episode-map-v8';
const SERIES_EPISODE_MAPPING_VERSION = 'series-episode-map-v1';

async function animeEpisodeMappingKey(rawId: string, forcedTmdbId?: string | null): Promise<string> {
  // This is intentionally recalculated from local relation rows. A curator
  // can change a PREQUEL/SEQUEL chain while the app is open, and reusing an
  // in-memory signature would let the old episode mapping survive.
  const chain = await buildAnimeChain(rawId).catch(() => []);
  const signature = chain.map(entry =>
    `${entry.externalId}:${entry.totalCount}:${entry.format ?? ''}`
  ).join('|');
  return `${ANIME_EPISODE_MAPPING_VERSION}:${forcedTmdbId || 'auto'}:${signature || rawId}`;
}

const TMDB_LANGUAGE_REGIONS: Record<string, string> = {
  ar: 'SA', ca: 'ES', de: 'DE', en: 'US', es: 'ES', fr: 'FR',
  hi: 'IN', id: 'ID', it: 'IT', ja: 'JP', ko: 'KR', nl: 'NL',
  pt: 'BR', ru: 'RU', th: 'TH', tr: 'TR', vi: 'VN', zh: 'CN',
};

function tmdbLocaleForAppLanguage(): string {
  return tmdbLocaleForOriginalLanguage(getLangCode()) ?? 'en-US';
}

function tmdbLocaleForOriginalLanguage(language?: string): string | null {
  const code = language?.toLowerCase();
  if (!code) return null;
  const region = TMDB_LANGUAGE_REGIONS[code];
  return region ? `${code}-${region}` : null;
}

function parseStreamingEpisodeTitle(title: string, fallbackNumber: number): { number: number; name: string | null } {
  const match = EPISODE_TITLE_RE.exec(title);
  if (!match) return { number: fallbackNumber, name: title.trim() || null };
  return { number: parseFloat(match[1]), name: match[2]?.trim() || null };
}

function hasUsefulEpisodeName(episode: MediaEpisode): episode is MediaEpisode & { name: string } {
  const name = episode.name?.trim();
  return !!name && !/^(?:episode|episodio|ep)\s*#?\d+(?:\s*\/\s*\d+)?$/i.test(name);
}

function mergeEpisodeNames(primary: MediaEpisode[], fallback: MediaEpisode[]): MediaEpisode[] {
  if (primary.length === 0) return fallback;
  const fallbackByNumber = new Map(fallback.map(episode => [episode.episode_number, episode]));
  const merged = primary.map(episode => {
    const backup = fallbackByNumber.get(episode.episode_number);
    return {
      ...episode,
      name: hasUsefulEpisodeName(episode) ? episode.name : (hasUsefulEpisodeName(backup ?? episode) ? backup?.name ?? null : null),
      cover_url: episode.cover_url ?? backup?.cover_url ?? null,
    };
  });
  const presentNumbers = new Set(merged.map(episode => episode.episode_number));
  for (const episode of fallback) {
    if (!presentNumbers.has(episode.episode_number)) merged.push(episode);
  }
  return merged.sort((a, b) => a.episode_number - b.episode_number);
}

function alignCachedAnimeNumbers(cached: MediaEpisode[], episodeOffset: number): MediaEpisode[] {
  if (episodeOffset <= 0 || cached.length === 0) return cached;
  const firstNumber = Math.min(...cached.filter(ep => ep.episode_number > 0).map(ep => ep.episode_number));
  if (Number.isFinite(firstNumber) && firstNumber < episodeOffset) {
    return cached.map(ep => ep.episode_number > 0 ? { ...ep, episode_number: ep.episode_number + episodeOffset } : ep);
  }
  return cached;
}

async function fetchFromAniList(numericId: number, externalId: string, episodeOffset = 0, mappingKey?: string): Promise<MediaEpisode[]> {
  const streamingEpisodes = await fetchAniListStreamingEpisodes(numericId);
  if (!streamingEpisodes?.length) return [];
  return streamingEpisodes.map((ep, i) => {
    const { number, name } = ep.title ? parseStreamingEpisodeTitle(ep.title, i + 1) : { number: i + 1, name: null };
    return {
      external_id:    externalId,
      season_number:  0,
      episode_number: number + episodeOffset,
      name,
      cover_url:      ep.thumbnail ?? null,
      source_key:     `anilist:${numericId}:episode:${number}`,
      mapping_key:    mappingKey ?? null,
    };
  });
}

// Numbers episodes continuously (e.g., continuing after prequels' episode counts).
async function fetchAnimeEpisodesFromTmdb(rawId: string, externalId: string, episodeOffset = 0, mappingKey?: string, forcedTmdbId?: number): Promise<MediaEpisode[]> {
  const match = await matchTmdbSeasonsForAnime(rawId, forcedTmdbId);
  if (!match) return [];

  const seasonNumbers = [...new Set(match.slices.map(s => s.season_number))];
  const fallbackLanguages = [...new Set([
    tmdbLocaleForAppLanguage(),
    tmdbLocaleForOriginalLanguage(match.originalLanguage),
  ].filter((language): language is string => !!language && language !== 'en-US'))];
  const episodes = await fetchTmdbEpisodesForSeasons(match.tmdbId, seasonNumbers, fallbackLanguages);
  if (!episodes.length) return [];

  const inMatchedRange = (ep: TmdbEpisodeSummary) => match.slices.some(s => {
    if (s.season_number !== ep.season_number) return false;
    const epIdx = ep.season_episode_number ?? ep.episode_number;
    return (epIdx >= s.episodeStart && epIdx <= s.episodeEnd)
      || (ep.episode_number >= s.episodeStart && ep.episode_number <= s.episodeEnd);
  });

  const filtered = episodes
    .filter(inMatchedRange)
    .sort((a, b) => a.season_number - b.season_number || a.episode_number - b.episode_number);
  if (!filtered.length) return [];

  return filtered.map((ep, i) => ({
    external_id:    externalId,
    season_number:  0,
    episode_number: episodeOffset + i + 1,
    name:           ep.name,
    cover_url:      ep.cover_url,
    source_key:     `tmdb:${match.tmdbId}:season:${ep.season_number}:episode:${ep.season_episode_number ?? ep.episode_number}`,
    mapping_key:    mappingKey ?? null,
  }));
}

async function fetchAnimeEpisodes(
  rawId: string,
  numericId: number,
  episodeOffset: number,
  cached: MediaEpisode[],
  mappingKey?: string,
  expectedCount = 0,
  forcedTmdbId?: number,
): Promise<MediaEpisode[]> {
  const tmdbEpisodes = await fetchAnimeEpisodesFromTmdb(rawId, rawId, episodeOffset, mappingKey, forcedTmdbId).catch(() => []);
  let fresh = tmdbEpisodes;

  // TMDB sometimes has the right season split but only generic "Episode N"
  // labels. Ask AniList for the same entry's streaming titles and use them
  // only to fill missing/generic labels rather than replacing good TMDB data.
  if (tmdbEpisodes.length === 0 || tmdbEpisodes.some(episode => !hasUsefulEpisodeName(episode))
    || (expectedCount > 0 && tmdbEpisodes.length < expectedCount)) {
    const anilistEpisodes = await fetchFromAniList(numericId, rawId, episodeOffset, mappingKey).catch(() => []);
    const tmdbCoversAniListCount = expectedCount <= 0 || tmdbEpisodes.length >= expectedCount;
    const primary = tmdbCoversAniListCount || anilistEpisodes.length === 0 ? tmdbEpisodes : anilistEpisodes;
    const fallback = primary === tmdbEpisodes ? anilistEpisodes : tmdbEpisodes;
    fresh = mergeEpisodeNames(primary, fallback);
  }

  // A retry must not erase episode titles that were already saved when both
  // providers return only generic or nameless entries.
  return mergeEpisodeNames(fresh, alignCachedAnimeNumbers(cached, episodeOffset));
}

// knownSeasonCount comes from the main media page's own already-fetched
// TmdbTvDetail (mapped to MediaPageData.totalCount_2 for series — see
// tmdb-mapper.ts) whenever the caller has it. Falling back to a fresh
// fetchTmdbDetail() call only when it doesn't (e.g. a cache-hit episodes
// read that never had that data to begin with) — this used to always
// re-fetch the FULL detail request (append_to_response=credits,
// recommendations,content_ratings and all) a second time purely to read
// one field the page had already fetched moments earlier.
async function fetchFromTmdb(numericId: number, externalId: string, knownSeasonCount?: number, mappingKey?: string): Promise<MediaEpisode[]> {
  let seasonCount = knownSeasonCount;
  if (!seasonCount) {
    const detail = await fetchTmdbDetail(numericId, 'series') as TmdbTvDetail | null;
    seasonCount = detail?.number_of_seasons ?? undefined;
  }
  if (!seasonCount) return [];
  const episodes = await fetchTmdbEpisodes(numericId, seasonCount);

  // Separate specials (season 0) from regular episodes
  const regularEpisodes = episodes.filter(ep => ep.season_number !== 0);
  const specialEpisodes = episodes.filter(ep => ep.season_number === 0);

  // Calculate cumulative episode numbers for regular episodes
  const seasonEpisodeCounts = new Map<number, number>();
  for (const ep of regularEpisodes) {
    seasonEpisodeCounts.set(
      ep.season_number,
      Math.max(seasonEpisodeCounts.get(ep.season_number) ?? 0, ep.episode_number)
    );
  }

  // Calculate total episodes up to each season (excluding specials)
  const seasonOffsets = new Map<number, number>();
  let offset = 0;
  for (const season of Array.from(seasonEpisodeCounts.keys()).sort((a, b) => a - b)) {
    seasonOffsets.set(season, offset);
    offset += seasonEpisodeCounts.get(season) ?? 0;
  }

  // Map regular episodes with cumulative numbering
  const mappedRegular = regularEpisodes.map(ep => ({
    ...ep,
    external_id: externalId,
    season_number: 0,
    episode_number: (seasonOffsets.get(ep.season_number) ?? 0) + ep.episode_number,
    source_key: `tmdb:${numericId}:season:${ep.season_number}:episode:${ep.season_episode_number ?? ep.episode_number}`,
    mapping_key: mappingKey ?? null,
  }));

  // Map specials with Sp1, Sp2, etc. notation (negative episode numbers for sorting)
  const mappedSpecials = specialEpisodes.map((ep, i) => ({
    ...ep,
    external_id: externalId,
    season_number: 0,
    episode_number: -(i + 1), // Negative numbers for sorting (Sp1 = -1, Sp2 = -2, etc.)
    name: ep.name ? `[Sp${i + 1}] ${ep.name}` : null,
    source_key: `tmdb:${numericId}:season:0:episode:${ep.season_episode_number ?? ep.episode_number}`,
    mapping_key: mappingKey ?? null,
  }));

  return [...mappedRegular, ...mappedSpecials];
}

// Cached in media_episode (see save_media_episodes) after the first fetch —
// read from there on every later visit instead of re-hitting either
// provider. Only anime (AniList) and series (TMDB) are supported; anything
// else (movies, games, books, ...) has no concept of episodes and returns [].
// force skips the cache read entirely (MediaPage's "Reintentar
// sincronización" button) — that's also how a series saved before this
// table existed gets its episodes backfilled: its cache is empty so a plain
// visit would already fetch fresh, but force lets the button refresh a
// title that's since gotten new episodes too, not just a never-fetched one.
export async function fetchMediaEpisodes(
  rawId: string,
  force = false,
  knownSeasonCount?: number,
  includeStandaloneUnit = false,
): Promise<MediaEpisode[]> {
  const { type, id: numericId } = parseExternalId(rawId);
  if (!numericId) return [];

  const episodeOffset = type === 'anime' ? await getAnimePrequelEpisodeOffset(rawId).catch(() => 0) : 0;
  const catalogEntry = type === 'anime' || type === 'series' ? await getCatalogEntry(rawId).catch(() => null) : null;
  const mappingKey = type === 'anime'
    ? await animeEpisodeMappingKey(rawId, catalogEntry?.episode_source_id)
    : type === 'series'
      ? `${SERIES_EPISODE_MAPPING_VERSION}:${catalogEntry?.episode_source_id || numericId}`
      : undefined;
  const cachedEpisodes = await getMediaEpisodes(rawId).catch(() => []);
  // Older rows have no provenance. Treat them as stale rather than letting
  // an old TMDB assignment survive a later chain/mapping correction.
  const hasCurrentEpisodeMapping = cachedEpisodes.length > 0
    && !!mappingKey
    && cachedEpisodes.every(episode => !!episode.source_key && episode.mapping_key === mappingKey);
  const reusableCachedEpisodes = hasCurrentEpisodeMapping ? cachedEpisodes : [];
  const expectedAnimeCount = catalogEntry?.total_count ?? 0;
  const hasExcessAnimeCache = type === 'anime'
    && expectedAnimeCount > 0
    && cachedEpisodes.length > expectedAnimeCount;

  const animeFormat = catalogEntry?.format?.toUpperCase() ?? '';
  const isStandaloneAnimeFormat = type === 'anime' && ['MOVIE', 'SPECIAL'].includes(animeFormat);
  if (isStandaloneAnimeFormat) {
    const isSingleUnit = animeFormat === 'MOVIE' || expectedAnimeCount <= 1;
    if (isSingleUnit) {
      // Outside a unified chain, films and one-off specials are individual
      // works, not episode lists. Clear stale rows left by a previous fuzzy
      // match to a related TV series.
      if (cachedEpisodes.length > 0) {
        await saveMediaEpisodes(rawId, []).catch(err => console.error('Failed to clear standalone anime episodes', err));
      }
      if (!includeStandaloneUnit) return [];

      // In a unified anime chain, preserve this work's place in the overall
      // watch order as one display-only episode. Do not persist it: the same
      // work should have no episode list when seasons are viewed separately.
      return [{
        external_id: rawId,
        season_number: 0,
        episode_number: episodeOffset + 1,
        name: catalogEntry?.title_main ?? null,
        // Unified movies are displayed as a horizontal episode card. Its
        // artwork therefore needs the work's banner rather than its portrait
        // cover, which is only appropriate for the standalone movie card.
        cover_url: firstCsvUrl(catalogEntry?.banners_csv),
      }];
    }

    // Multi-episode specials may have their own independent TMDB series
    // listing (for example a two-part web special). Run the same strict
    // title/year/count matcher as other anime; fetchAnimeEpisodes falls back
    // to AniList when no safe TMDB match exists.
    if (!force && hasCurrentEpisodeMapping && !hasExcessAnimeCache) return cachedEpisodes;
    const ownEpisodes = await fetchAnimeEpisodes(
      rawId,
      numericId,
      episodeOffset,
      reusableCachedEpisodes,
      mappingKey,
      expectedAnimeCount,
      catalogEntry?.episode_source_id ? Number(catalogEntry.episode_source_id) : undefined,
    );
    const boundedEpisodes = expectedAnimeCount > 0 ? ownEpisodes.slice(0, expectedAnimeCount) : ownEpisodes;
    await saveMediaEpisodes(rawId, boundedEpisodes).catch(err => console.error('Failed to refresh standalone anime episodes', err));
    return boundedEpisodes;
  }

  if (!force) {
    const cached = cachedEpisodes;
    if (cached.length > 0) {
      const expectedTotal = catalogEntry?.total_count ?? 0;
      const isCacheIncomplete = expectedTotal > 0 && cached.length < expectedTotal;

      if (hasCurrentEpisodeMapping && !isCacheIncomplete && !hasExcessAnimeCache) {
        if (episodeOffset > 0 && cached[0].episode_number < episodeOffset) {
          const shifted = cached.map(ep => ({
            ...ep,
            episode_number: ep.episode_number + episodeOffset,
          }));
          saveMediaEpisodes(rawId, shifted).catch(err => console.error('Failed to update shifted episodes', err));
          return shifted;
        }
        return cached;
      }
    }
  }

  let fresh: MediaEpisode[];
  if (type === 'anime') {
    fresh = await fetchAnimeEpisodes(rawId, numericId, episodeOffset, reusableCachedEpisodes, mappingKey, expectedAnimeCount,
      catalogEntry?.episode_source_id ? Number(catalogEntry.episode_source_id) : undefined);
  } else if (type === 'series') {
    const sourceId = catalogEntry?.episode_source_id ? Number(catalogEntry.episode_source_id) : numericId;
    fresh = await fetchFromTmdb(sourceId, rawId, catalogEntry?.episode_source_id ? undefined : knownSeasonCount, mappingKey).catch(() => []);
  } else {
    return [];
  }

  if (type === 'anime' && expectedAnimeCount > 0) {
    fresh = fresh.slice(0, expectedAnimeCount);
  }

  if (fresh.length > 0 || hasExcessAnimeCache) {
    await saveMediaEpisodes(rawId, fresh).catch(err => console.error('Failed to save media episodes', err));
  }
  return fresh;
}

// Episode-NAME lookup for the Local section (the "próximo episodio"/history
// labels and the "Localizar" rename flow — see LocalMediaDetailPanel and
// folderMatch.ts's buildLocateRenamePlan), re-keyed to whatever numbering
// each of those callers' own episode number already is:
//  - anime: LOCAL to the specific season's own externalId — every local
//    progress/history number in this app is season-relative for anime (each
//    season is its own separate library entry), but fetchMediaEpisodes'
//    own episode_number field is globally offset across the whole prequel
//    chain (see getAnimePrequelEpisodeOffset). Since that fetch already
//    only ever returns THIS season's own episodes to begin with, sorting
//    and re-numbering by array position recovers the season-local number
//    without needing the offset at all.
//  - series: this app never splits a TMDB series' library entry per season
//    (getAllLibraryEntries filters synthetic per-season ids out), so a
//    series' own progress/history numbers are already the single show's
//    plain continuous count — exactly what fetchMediaEpisodes already
//    returns for series (see fetchFromTmdb's own cumulative numbering) —
//    no re-numbering needed, matched directly.
// `force` bypasses the media_episode cache (see fetchMediaEpisodes) — used
// by the "Localizar" flow specifically, since a stale/partial cache (e.g.
// saved back when the anime<->TMDB season match below didn't exist yet, or
// picked the wrong candidate) would otherwise keep silently coming back
// empty forever; a one-off manual rename is worth paying for a fresh fetch,
// where the "próximo episodio"/history display (called far more often) isn't.
export async function fetchLocalSeasonEpisodeNames(externalId: string, force = false): Promise<Map<number, string>> {
  const { type } = parseExternalId(externalId);
  const map = new Map<number, string>();
  if (type !== 'anime' && type !== 'series') return map;

  // Localizar may force a refresh, but a provider can return a partial list
  // (or no list) even while the media page already has a cached list with the
  // real names. Compare both instead of allowing that refresh to erase the
  // titles shown in the Episodios tab.
  const cached = await getMediaEpisodes(externalId).catch(() => []);
  const fetched = await fetchMediaEpisodes(externalId, force).catch(() => []);
  const namedCount = (episodes: MediaEpisode[]) => episodes.filter(ep => !!ep.name?.trim()).length;
  const cachedNamedCount = namedCount(cached);
  const fetchedNamedCount = namedCount(fetched);
  // Keep the cached list when it is at least as complete as the refresh: it
  // is the same source already rendered by the media page, while a forced
  // provider refresh can contain generic/empty names for some episodes.
  const preferred = cachedNamedCount > fetchedNamedCount
    ? cached
    : fetchedNamedCount > cachedNamedCount
      ? fetched
      : cached;
  const fallback = preferred === cached ? fetched : cached;

  // Merge per episode instead of choosing one complete list. This preserves
  // a real cached title when the refresh only supplies names for part of the
  // season, and fills any missing entries from the other source.
  const episodes = preferred.map((episode, index) => {
    if (episode.name?.trim()) return episode;
    const byNumber = fallback.find(candidate =>
      candidate.episode_number === episode.episode_number && candidate.name?.trim()
    );
    const byPosition = fallback
      .slice()
      .sort((a, b) => a.episode_number - b.episode_number)[index];
    const fallbackName = byNumber?.name?.trim() || byPosition?.name?.trim();
    return fallbackName ? { ...episode, name: fallbackName } : episode;
  });
  if (type === 'anime') {
    [...episodes].sort((a, b) => a.episode_number - b.episode_number).forEach((ep, i) => {
      if (hasUsefulEpisodeName(ep)) {
        // The local rename flow uses season-relative numbers, while some
        // cached/provider lists carry a continuous prequel-chain number.
        // Keep both keys so a resolved season ID can still find its title.
        map.set(i + 1, ep.name);
        if (ep.episode_number > 0) map.set(ep.episode_number, ep.name);
      }
    });
  } else {
    for (const ep of episodes) {
      if (hasUsefulEpisodeName(ep)) map.set(ep.episode_number, ep.name!);
    }
  }
  return map;
}

// Series progress is stored as one continuous episode number, while capture
// filenames need TMDB's season-local SxxExx. `source_key` preserves that
// original position after fetchFromTmdb converts episodes to cumulative order.
export async function fetchLocalSeriesEpisodeLabels(externalId: string): Promise<Map<number, string>> {
  const labels = new Map<number, string>();
  if (parseExternalId(externalId).type !== 'series') return labels;

  const episodes = await fetchMediaEpisodes(externalId).catch(() => []);
  const pad = (value: number) => String(value).padStart(2, '0');
  for (const episode of episodes) {
    const sourcePosition = episode.source_key?.match(/:season:(\d+):episode:(\d+)$/);
    if (!sourcePosition || episode.episode_number <= 0) continue;

    const season = Number(sourcePosition[1]);
    const seasonEpisode = Number(sourcePosition[2]);
    if (season <= 0 || seasonEpisode <= 0) continue;
    labels.set(episode.episode_number, `S${pad(season)}E${pad(seasonEpisode)}`);
  }
  return labels;
}
