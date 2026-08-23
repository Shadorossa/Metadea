// Per-episode data ("Episodios" tab on the media page), split out of
// mediaService.ts the same way comic-issues.ts/book-editions.ts are —
// sourced from TMDB (series) or AniList's streamingEpisodes (anime), the
// only two providers this app uses that expose anything episode-level at all.
import { fetchTmdbDetail, fetchTmdbEpisodes, type TmdbTvDetail } from '../search/providers/tmdb';
import { fetchAniListDetail } from '../search/providers/anilist';
import { parseExternalId } from './mapper-utils';
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

async function fetchFromAniList(numericId: number, externalId: string): Promise<MediaEpisode[]> {
  const detail = await fetchAniListDetail(numericId);
  if (!detail?.streamingEpisodes?.length) return [];
  return detail.streamingEpisodes.map((ep, i) => {
    const { number, name } = ep.title ? parseStreamingEpisodeTitle(ep.title, i + 1) : { number: i + 1, name: null };
    return {
      external_id:    externalId,
      season_number:  0,
      episode_number: number,
      name,
      cover_url:      ep.thumbnail ?? null,
    };
  });
}

async function fetchFromTmdb(numericId: number, externalId: string): Promise<MediaEpisode[]> {
  const detail = await fetchTmdbDetail(numericId, 'series') as TmdbTvDetail | null;
  if (!detail?.number_of_seasons) return [];
  const episodes = await fetchTmdbEpisodes(numericId, detail.number_of_seasons);
  return episodes.map(ep => ({ ...ep, external_id: externalId }));
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
export async function fetchMediaEpisodes(rawId: string, force = false): Promise<MediaEpisode[]> {
  if (!force) {
    const cached = await getMediaEpisodes(rawId).catch(() => []);
    if (cached.length > 0) return cached;
  }

  const { type, id: numericId } = parseExternalId(rawId);
  if (!numericId) return [];

  let fresh: MediaEpisode[] = [];
  if (type === 'anime') {
    fresh = await fetchFromAniList(numericId, rawId).catch(() => []);
  } else if (type === 'series') {
    fresh = await fetchFromTmdb(numericId, rawId).catch(() => []);
  } else {
    return [];
  }

  if (fresh.length > 0) {
    saveMediaEpisodes(rawId, fresh).catch(err => console.error('Failed to save media episodes', err));
  }
  return fresh;
}
