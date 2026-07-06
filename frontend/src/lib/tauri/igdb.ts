import { invoke, tauriTry, tauriCmd } from './core';

export interface IgdbNamed { id: number; name: string }
export interface IgdbImage { id: number; image_id: string }
export interface IgdbCover { id: number; image_id: string }
export interface IgdbInvolvedCompany {
  id:         number;
  company?:   IgdbNamed;
  developer?: boolean;
  publisher?: boolean;
}
export interface IgdbGame {
  id:                   number;
  name:                 string;
  summary?:             string;
  cover?:               IgdbCover;
  screenshots?:         IgdbImage[];
  artworks?:            IgdbImage[];
  genres?:              IgdbNamed[];
  involved_companies?:  IgdbInvolvedCompany[];
  first_release_date?:  number; // unix timestamp
  rating?:              number;
  rating_count?:        number;
}

export function igdbImageUrl(imageId: string, size = 'screenshot_big'): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

export async function igdbSearch(query: string, isVisualNovel = false): Promise<IgdbGame[]> {
  return invoke<IgdbGame[]>('igdb_search', { query, isVisualNovel });
}

export async function igdbGetGameDetail(igdbId: number): Promise<Record<string, unknown> | null> {
  return tauriTry<Record<string, unknown> | null>('igdb_get_game_detail', null, { igdbId });
}

export async function igdbGetBaseGames(igdbId: number): Promise<unknown[] | null> {
  return tauriTry<unknown[] | null>('igdb_get_base_games', null, { igdbId });
}

export async function igdbGetRelationGraph(rootId: number): Promise<unknown[]> {
  return tauriTry<unknown[]>('igdb_get_relation_graph', [], { rootId });
}

export async function igdbGetCoverBySteamId(appId: string, gameName: string): Promise<string | null> {
  return tauriCmd<string | null>('igdb_get_cover_by_steam_id', null, { appId, gameName });
}

export interface IgdbCandidate {
  id:        number;
  name:      string;
  year:      number;
  cover_url: string;
  developer: string;
}

export async function igdbSearchCandidates(gameName: string): Promise<IgdbCandidate[]> {
  return tauriCmd<IgdbCandidate[]>('igdb_search_candidates', [], { gameName });
}

export async function igdbForceByIgdbId(appId: string, gameName: string, igdbId: number): Promise<string> {
  return tauriCmd<string>('igdb_force_by_igdb_id', '', { appId, gameName, igdbId });
}
