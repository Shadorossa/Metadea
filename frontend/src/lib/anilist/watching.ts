import { invoke } from '@tauri-apps/api/core';
import { API_ENDPOINTS } from '../api/endpoints';
import { graphqlPost } from '../api/client';

export interface AnimeWatchEntry {
  id: number;
  mediaId: number;
  title: string;
  cover?: string;
  totalEpisodes?: number;
  currentProgress: number;
  score: number;
  status: string;
}

const WATCHING_QUERY = `
  query {
    MediaListCollection(userName: "viewer", type: ANIME, status: CURRENT) {
      lists {
        entries {
          id
          mediaId
          progress
          score
          status
          media {
            id
            title {
              romaji
              english
              native
            }
            coverImage {
              large
            }
            episodes
          }
        }
      }
    }
  }
`;

const PLAN_TO_WATCH_QUERY = `
  query {
    MediaListCollection(userName: "viewer", type: ANIME, status: PLANNING) {
      lists {
        entries {
          id
          mediaId
          progress
          score
          status
          media {
            id
            title {
              romaji
              english
              native
            }
            coverImage {
              large
            }
            episodes
          }
        }
      }
    }
  }
`;

async function queryAniList<T>(token: string, query: string): Promise<{ data: T }> {
  const { ok, status, result } = await graphqlPost<T>(API_ENDPOINTS.ANILIST, query, undefined, { token });

  if (!ok) {
    throw new Error(`AniList API error: ${status}`);
  }
  if (result?.errors) {
    throw new Error(`AniList GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
  }

  return { data: result?.data as T };
}

function parseEntries(rawEntries: any[]): AnimeWatchEntry[] {
  return rawEntries.map(entry => ({
    id: entry.id,
    mediaId: entry.mediaId,
    title: entry.media.title.romaji || entry.media.title.english || entry.media.title.native || 'Unknown',
    cover: entry.media.coverImage?.large,
    totalEpisodes: entry.media.episodes,
    currentProgress: entry.progress || 0,
    score: entry.score || 0,
    status: entry.status,
  }));
}

export async function fetchAniListAnimes(token: string, query: string): Promise<AnimeWatchEntry[]> {
  const result = await queryAniList<any>(token, query);
  const lists = result.data?.MediaListCollection?.lists || [];
  const allEntries: any[] = [];

  for (const list of lists) {
    if (list.entries) {
      allEntries.push(...list.entries);
    }
  }

  return parseEntries(allEntries);
}

export async function getWatchingAnime(token: string): Promise<AnimeWatchEntry[]> {
  return fetchAniListAnimes(token, WATCHING_QUERY);
}

export async function getPlanToWatchAnime(token: string): Promise<AnimeWatchEntry[]> {
  return fetchAniListAnimes(token, PLAN_TO_WATCH_QUERY);
}

export async function getAllAnimeFromAniList(token: string): Promise<{ watching: AnimeWatchEntry[]; planToWatch: AnimeWatchEntry[] }> {
  const [watching, planToWatch] = await Promise.all([
    getWatchingAnime(token),
    getPlanToWatchAnime(token),
  ]);
  return { watching, planToWatch };
}

export async function updateAniListProgress(token: string, mediaId: number, progress: number, status?: string): Promise<void> {
  const mutation = `
    mutation ($mediaId: Int, $progress: Int, $status: MediaListStatus) {
      SaveMediaListEntry(mediaId: $mediaId, progress: $progress, status: $status) {
        id
        progress
        status
      }
    }
  `;

  const { ok, status: httpStatus, result } = await graphqlPost(
    API_ENDPOINTS.ANILIST,
    mutation,
    { mediaId, progress, status },
    { token },
  );

  if (!ok) {
    throw new Error(`AniList API error: ${httpStatus}`);
  }
  if (result?.errors) {
    throw new Error(`AniList GraphQL error: ${result.errors.map(e => e.message).join(', ')}`);
  }
}
