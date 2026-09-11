// Per-episode data ("Episodios" tab on the media page), split out of
// mediaService.ts the same way comic-issues.ts/book-editions.ts are —
// sourced from TMDB (series) or AniList's streamingEpisodes (anime), the
// only two providers this app uses that expose anything episode-level at all.
import { fetchTmdbDetail, fetchTmdbEpisodes, fetchTmdbEpisodesForSeasons, type TmdbTvDetail, type TmdbEpisodeSummary } from '../search/providers/tmdb';
import { fetchAniListStreamingEpisodes } from '../search/providers/anilist';
import { parseExternalId } from './mapper-utils';
import { matchTmdbSeasonsForAnime, getAnimePrequelEpisodeOffset } from './anime-tmdb-match';
import { getMediaEpisodes, saveMediaEpisodes, type MediaEpisode } from '../tauri';

// AniList's streamingEpisodes titles read like "Episode 12 - The Title"
// (sometimes just "Episode 12", occasionally missing the "Episode" word
// entirely for a one-shot/movie) — there's no separate numeric field.
const EPISODE_TITLE_RE = /Episode\s+(\d+(?:\.\d+)?)\s*(?:[-–—]\s*(.+))?/i;

function parseStreamingEpisodeTitle(title: string, fallbackNumber: number): { number: number; name: string | null } {
  const match = EPISODE_TITLE_RE.exec(title);
  if (!match) return { number: fallbackNumber, name: title.trim() || null };
  return { number: parseFloat(match[1]), name: match[2]?.trim() || null };
}

async function fetchFromAniList(numericId: number, externalId: string, episodeOffset = 0): Promise<MediaEpisode[]> {
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
    };
  });
}

// Numbers episodes continuously (e.g., continuing after prequels' episode counts).
async function fetchAnimeEpisodesFromTmdb(rawId: string, externalId: string, episodeOffset = 0): Promise<MediaEpisode[]> {
  const match = await matchTmdbSeasonsForAnime(rawId);
  if (!match) return [];

  const seasonNumbers = [...new Set(match.slices.map(s => s.season_number))];
  const episodes = await fetchTmdbEpisodesForSeasons(match.tmdbId, seasonNumbers);
  if (!episodes.length) return [];

  const inMatchedRange = (ep: TmdbEpisodeSummary) => match.slices.some(s =>
    s.season_number === ep.season_number && ep.episode_number >= s.episodeStart && ep.episode_number <= s.episodeEnd,
  );

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
  }));
}

// knownSeasonCount comes from the main media page's own already-fetched
// TmdbTvDetail (mapped to MediaPageData.totalCount_2 for series — see
// tmdb-mapper.ts) whenever the caller has it. Falling back to a fresh
// fetchTmdbDetail() call only when it doesn't (e.g. a cache-hit episodes
// read that never had that data to begin with) — this used to always
// re-fetch the FULL detail request (append_to_response=credits,
// recommendations,content_ratings and all) a second time purely to read
// one field the page had already fetched moments earlier.
async function fetchFromTmdb(numericId: number, externalId: string, knownSeasonCount?: number): Promise<MediaEpisode[]> {
  let seasonCount = knownSeasonCount;
  if (!seasonCount) {
    const detail = await fetchTmdbDetail(numericId, 'series') as TmdbTvDetail | null;
    seasonCount = detail?.number_of_seasons ?? undefined;
  }
  if (!seasonCount) return [];
  const episodes = await fetchTmdbEpisodes(numericId, seasonCount);

  // Calculate cumulative episode numbers across seasons (like anime)
  // instead of resetting to 1 for each season
  const seasonEpisodeCounts = new Map<number, number>();
  for (const ep of episodes) {
    seasonEpisodeCounts.set(
      ep.season_number,
      Math.max(seasonEpisodeCounts.get(ep.season_number) ?? 0, ep.episode_number)
    );
  }

  // Calculate total episodes up to each season
  const seasonOffsets = new Map<number, number>();
  let offset = 0;
  for (const season of Array.from(seasonEpisodeCounts.keys()).sort((a, b) => a - b)) {
    seasonOffsets.set(season, offset);
    offset += seasonEpisodeCounts.get(season) ?? 0;
  }

  return episodes.map(ep => ({
    ...ep,
    external_id: externalId,
    season_number: 0,
    episode_number: (seasonOffsets.get(ep.season_number) ?? 0) + ep.episode_number,
  }));
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
export async function fetchMediaEpisodes(rawId: string, force = false, knownSeasonCount?: number): Promise<MediaEpisode[]> {
  const { type, id: numericId } = parseExternalId(rawId);
  if (!numericId) return [];

  const episodeOffset = type === 'anime' ? await getAnimePrequelEpisodeOffset(rawId).catch(() => 0) : 0;

  if (!force) {
    const cached = await getMediaEpisodes(rawId).catch(() => []);
    if (cached.length > 0) {
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

  let fresh: MediaEpisode[] = [];
  if (type === 'anime') {
    fresh = await fetchAnimeEpisodesFromTmdb(rawId, rawId, episodeOffset).catch(() => []);
    if (fresh.length === 0) {
      fresh = await fetchFromAniList(numericId, rawId, episodeOffset).catch(() => []);
    }
  } else if (type === 'series') {
    fresh = await fetchFromTmdb(numericId, rawId, knownSeasonCount).catch(() => []);
  } else {
    return [];
  }

  if (fresh.length > 0) {
    saveMediaEpisodes(rawId, fresh).catch(err => console.error('Failed to save media episodes', err));
  }
  return fresh;
}
