import { invoke, tauriTry, tauriCmd } from './bridge';

export interface IgdbNamed { id: number; name: string }
export interface IgdbImage { id: number; image_id: string }
export interface IgdbCover { id: number; image_id: string }
export interface IgdbInvolvedCompany {
  id:         number;
  company?:   IgdbNamed & { logo?: { image_id: string } };
  developer?: boolean;
  publisher?: boolean;
}
export interface IgdbGame extends Record<string, unknown> {
  id:                   number;
  name:                 string;
  url?:                 string;
  summary?:             string;
  banner_image_id?:     string | null;
  cover?:               IgdbCover;
  screenshots?:         IgdbImage[];
  artworks?:            IgdbImage[];
  genres?:              IgdbNamed[];
  involved_companies?:  IgdbInvolvedCompany[];
  first_release_date?:  number; // unix timestamp
  rating?:              number;
  total_rating?:        number;
  rating_count?:        number;
  hypes?:               number; // pre-release "anticipation" follow count - used as a popularity proxy
  category?:            number;
  status?:              number;
  game_type?:           number;
  platforms?:           IgdbNamed[];
  alternative_names?:   { name: string; comment?: string }[];
  store_links?:         { platform: string; url: string }[] | null;
  parent_game?:         { id: number; name: string; cover?: IgdbCover; first_release_date?: number; game_type?: number; is_vn?: boolean };
  version_parent?:      { id: number; name: string; cover?: IgdbCover; first_release_date?: number; game_type?: number; is_vn?: boolean };
  remakes?:             IgdbGame[];
  remasters?:           IgdbGame[];
  expansions?:          IgdbGame[];
  standalone_expansions?: IgdbGame[];
  expanded_games?:      IgdbGame[];
  ports?:               IgdbGame[];
  forks?:               IgdbGame[];
}

export function igdbImageUrl(imageId: string, size = 'screenshot_big'): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${imageId}.jpg`;
}

export interface IgdbSearchPage {
  games: IgdbGame[];
  hasMore: boolean;
}

export interface IgdbSearchFilters {
  filterYear?: number;
  filterSeason?: string;
  filterGenres?: string[];
}

export async function igdbSearch(
  query: string,
  isVisualNovel = false,
  page = 1,
  onlyCategories?: number[],
  filters?: IgdbSearchFilters,
): Promise<IgdbSearchPage> {
  return invoke<IgdbSearchPage>('igdb_search', {
    query, isVisualNovel, page, onlyCategories,
    filterYear: filters?.filterYear,
    filterSeason: filters?.filterSeason,
    filterGenres: filters?.filterGenres,
  });
}

export async function igdbSearchUnfiltered(query: string, page = 1): Promise<IgdbSearchPage> {
  return invoke<IgdbSearchPage>('igdb_search_unfiltered', { query, page });
}

// Games releasing between the two unix timestamps — single request. Silently
// returns [] if IGDB isn't configured or the call fails (tauriCmd fallback),
// so the Home calendar's "General" view can call this unconditionally.
export async function igdbUpcomingReleases(startUnix: number, endUnix: number): Promise<IgdbGame[]> {
  return tauriCmd<IgdbGame[]>('igdb_upcoming_releases', [], { startUnix, endUnix });
}

export async function igdbGetGameDetail(igdbId: number): Promise<IgdbGame | null> {
  return tauriTry<IgdbGame | null>('igdb_get_game_detail', null, { igdbId });
}

/** All IGDB cover variants, including localized covers, for one game. */
export async function igdbGetLocalizedCovers(igdbId: number): Promise<string[]> {
  return tauriCmd<string[]>('igdb_get_localized_covers', [], { igdbId });
}

export async function igdbGetBaseGames(igdbId: number, relationField: 'remakes' | 'remasters'): Promise<unknown[] | null> {
  return tauriTry<unknown[] | null>('igdb_get_base_games', null, { igdbId, relationField });
}

export async function igdbGetRelationGraph(rootId: number): Promise<unknown[]> {
  return tauriTry<unknown[]>('igdb_get_relation_graph', [], { rootId });
}

export async function igdbGetCoverBySteamId(appId: string, gameName: string, launcher: string): Promise<string | null> {
  return tauriCmd<string | null>('igdb_get_cover_by_steam_id', null, { appId, gameName, launcher });
}

export interface IgdbCandidate {
  id:          number;
  name:        string;
  year:        number;
  cover_url:   string;
  developer:   string;
  category?:   number | null;
  externalId?: string;
  type?:       string;
  source?:     'database' | 'igdb';
}

export async function igdbSearchCandidates(gameName: string): Promise<IgdbCandidate[]> {
  return tauriCmd<IgdbCandidate[]>('igdb_search_candidates', [], { gameName });
}

export async function igdbForceByIgdbId(appId: string, gameName: string, igdbId: number): Promise<string> {
  return tauriCmd<string>('igdb_force_by_igdb_id', '', { appId, gameName, igdbId });
}
