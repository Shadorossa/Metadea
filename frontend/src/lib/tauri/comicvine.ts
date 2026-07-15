import { invoke } from './core';

export interface ComicVineImage {
  medium_url: string | null;
  small_url:  string | null;
}

export interface ComicVinePublisher {
  name: string | null;
}

export interface ComicVineVolume {
  id:              number;
  name:            string;
  image:           ComicVineImage | null;
  start_year:      string | null;
  publisher:       ComicVinePublisher | null;
  count_of_issues: number | null;
  description:     string | null;
  deck:            string | null;
  site_detail_url: string | null;
}

export interface ComicVineSearchPage {
  volumes:  ComicVineVolume[];
  has_more: boolean;
}

export async function comicVineSearch(query: string, page = 1): Promise<ComicVineSearchPage> {
  return invoke<ComicVineSearchPage>('comicvine_search', { query, page });
}

export async function comicVineGetVolume(volumeId: number): Promise<ComicVineVolume | null> {
  return invoke<ComicVineVolume | null>('comicvine_get_volume', { volumeId });
}
